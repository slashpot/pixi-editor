import type { Container } from 'pixi.js';
import { displayNodes, type Entry, instanceCount, instancesOf, isShown } from './fiber-index';
import { createGridOverlay } from './grid';
import { type ChangeMode, currentOrientation, planEdits, sourceNumber } from './plan-edits';
import { round } from './pixi-node';
import type { ElementInfo } from '../shared';
import type { Session } from './session';
import { getApp, type Point, toCss, toStage } from './viewport';

/** Pointer travel (CSS px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;
/** Arrow-key nudges are written once the keys go quiet for this long. */
const NUDGE_COMMIT_MS = 500;
/** A move smaller than this (in the parent's units) is hand jitter, not an edit of that axis. */
const MIN_MOVE = 0.5;

/** Another object rendered from the same JSX (a `.map`), with where it started. */
interface Follower {
  node: Container;
  x: number;
  y: number;
}

/**
 * Who a move applies to. An item a `.map` callback returns directly gets its own value
 * (`instance`: its index in the list). Otherwise all instances share the source, so they
 * move along while dragging — the screen shows what writing the source will do.
 */
interface MoveScope {
  instance?: number;
  followers: Follower[];
}

interface GizmoOptions {
  /** Grid step in the parent's coordinates; 0 = no snapping. */
  snapStep(): number;
  openInEditor(src: string): void;
}

type Drag =
  | {
      kind: 'move';
      node: Container;
      scope: MoveScope;
      start: Point;
      startX: number;
      startY: number;
      moved: boolean;
      onClick?: () => void;
    }
  | {
      kind: 'resize';
      node: Container;
      start: Point;
      /** Bounds size in global coords when the drag began. */
      boundsW: number;
      boundsH: number;
      /** `size` edits width/height props; `scale` edits the scale prop. */
      mode: 'size' | 'scale';
      startW: number;
      startH: number;
      startSx: number;
      startSy: number;
      moved: boolean;
    };

/**
 * How a live value maps back to the source: `add` for positions (source + drag delta),
 * `mul` for sizes and scale (source × drag ratio). Using the source value as the base
 * keeps components that transform their props (`x={props.x + 10}`) correct.
 */
interface Item {
  prop: string;
  from: number;
  to: number;
  mode: ChangeMode;
}

/**
 * Selection outline with a move gesture (drag the object), a resize handle
 * (bottom-right corner), arrow-key nudging, a snap grid and a hover outline
 * for the hierarchy. Changes apply to the live Pixi object while dragging and
 * are written to the source once on release, through `planEdits` → `session.commit`.
 */
export function createGizmo(session: Session, { snapStep, openInEditor }: GizmoOptions) {
  const outline = el('div', OUTLINE_STYLE);
  const hoverBox = el('div', HOVER_STYLE);
  const label = el('a', LABEL_STYLE);
  const handle = el('div', HANDLE_STYLE);
  const grid = createGridOverlay();
  document.body.append(hoverBox, outline, label, handle);

  let drag: Drag | undefined;
  let nudge: { node: Container; scope: MoveScope; startX: number; startY: number; timer: number } | undefined;
  let hover: Entry | undefined;

  label.onclick = (e) => {
    e.preventDefault();
    if (session.ref) openInEditor(session.ref.src);
  };

  handle.addEventListener('pointerdown', (e) => {
    const node = session.node;
    const app = getApp();
    if (!node || !session.info || !app) return;
    e.preventDefault();
    e.stopPropagation();
    flushNudge();
    const b = node.getBounds();
    const props = new Set(session.info.props.map((p) => p.name));
    drag = {
      kind: 'resize',
      node,
      start: toStage(app, e.clientX, e.clientY),
      boundsW: Math.max(b.width, 1),
      boundsH: Math.max(b.height, 1),
      mode: props.has('width') || props.has('height') ? 'size' : 'scale',
      startW: node.width,
      startH: node.height,
      startSx: node.scale.x,
      startSy: node.scale.y,
      moved: false,
    };
  });

  // window capture: runs before (and without being stopped by) the selection logic
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', onUp, { capture: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) {
      revert(drag);
      drag = undefined;
    }
  });

  function onMove(e: PointerEvent) {
    const app = getApp();
    if (!drag || !app) return;
    const p = toStage(app, e.clientX, e.clientY);
    const css = toCss(app, drag.start.x, drag.start.y);
    if (!drag.moved && Math.hypot(e.clientX - css.x, e.clientY - css.y) < DRAG_THRESHOLD) return;
    drag.moved = true;
    e.stopPropagation();
    const step = e.altKey ? 0 : snapStep();
    if (drag.kind === 'move') moveTo(drag, p, step, e.shiftKey);
    else resizeTo(drag, p, step, e.shiftKey);
  }

  function onUp(e: PointerEvent) {
    const done = drag;
    if (!done) return;
    drag = undefined;
    e.stopPropagation();
    if (!done.moved) {
      if (done.kind === 'move') done.onClick?.();
      return;
    }
    const n = done.node;
    if (done.kind === 'move') {
      void persist(
        n,
        [
          { prop: 'x', from: done.startX, to: n.x, mode: 'add' },
          { prop: 'y', from: done.startY, to: n.y, mode: 'add' },
        ],
        undefined,
        done.scope,
      );
    } else if (done.mode === 'size') {
      void persist(n, [
        { prop: 'width', from: done.startW, to: n.width, mode: 'mul' },
        { prop: 'height', from: done.startH, to: n.height, mode: 'mul' },
      ]);
    } else {
      void persist(n, [{ prop: 'scale', from: done.startSx, to: n.scale.x, mode: 'mul' }], () =>
        n.scale.set(done.startSx, done.startSy),
      );
    }
  }

  /**
   * Writes the changed props back to the source, asking where planEdits needs a
   * decision. Whatever isn't written is put back on the live object.
   */
  async function persist(node: Container, items: Item[], revertScale?: () => void, scope?: MoveScope) {
    const followers = scope?.followers ?? [];
    const putBack = (props: string[]) => {
      for (const i of items) if (props.includes(i.prop) && i.prop !== 'scale') setProp(node, i.prop, i.from);
      for (const f of followers) {
        if (props.includes('x')) f.node.x = f.x;
        if (props.includes('y')) f.node.y = f.y;
      }
      if (props.includes('scale')) revertScale?.();
    };
    const moved = (i: Item) => Math.abs(i.to - i.from) >= (i.mode === 'add' ? MIN_MOVE : 1e-6);
    putBack(items.filter((i) => !moved(i)).map((i) => i.prop));
    const changed = items.filter(moved);
    if (changed.length === 0) return;

    const info = session.info;
    if (!info || session.node !== node) {
      putBack(changed.map((c) => c.prop));
      return session.setError('The source has not loaded yet; reverted, please try again');
    }

    const orientation = currentOrientation();
    const solo = scope?.instance;
    const changes = changed.map((i) => {
      // a pixi object's own position is its prop; a shared expression says nothing about this item
      const fromLive = solo !== undefined && !session.entry?.component;
      const value = fromSource(i, fromLive ? undefined : sourceNumber(info, i.prop, orientation, i.mode));
      // positions are written as whole numbers (the Inspector takes fractions)
      if (i.mode === 'add') return { prop: i.prop, value: Math.round(value), mode: i.mode };
      return { prop: i.prop, value: i.prop === 'scale' ? round2(value) : round(value), mode: i.mode };
    });
    const plan = planEdits(info, changes, instanceCount(info.src), (q) => window.confirm(q), orientation, solo);
    if (plan.blocked) {
      putBack(changed.map((c) => c.prop));
      return session.setError(plan.blocked);
    }
    putBack(plan.reverted);
    const written = await session.commit(plan.edits);
    if (!written) putBack(plan.edits.map((edit) => edit.prop));
  }

  function flushNudge() {
    if (!nudge) return;
    const { node, scope, startX, startY, timer } = nudge;
    clearTimeout(timer);
    nudge = undefined;
    void persist(
      node,
      [
        { prop: 'x', from: startX, to: node.x, mode: 'add' },
        { prop: 'y', from: startY, to: node.y, mode: 'add' },
      ],
      undefined,
      scope,
    );
  }

  /** How moving the selection (rendered as `node`) is written; see MoveScope. */
  function moveScope(node: Container): MoveScope {
    const entry = session.entry;
    const info = session.info;
    if (!entry) return { followers: [] };
    // the same JSX rendered by the same parent: the items of one list, in order
    const items = instancesOf(entry.src).filter((e) => e.parent === entry.parent);
    if (items.length < 2) return { followers: [] };
    if (info?.inLoop && (!entry.component || ['x', 'y'].every((p) => hasPlainNumber(info, p)))) {
      return { instance: items.indexOf(entry), followers: [] };
    }
    const followers = instancesOf(entry.src)
      .map((e) => displayNodes(e)[0])
      .filter((n): n is Container => !!n && n !== node && !n.destroyed)
      .map((n) => ({ node: n, x: n.x, y: n.y }));
    return { followers };
  }

  function place(box: HTMLElement, nodes: Container[]) {
    const app = getApp();
    const shown = nodes.filter((n) => !n.destroyed && n.parent && isShown(n));
    if (!app || shown.length === 0) {
      box.style.display = 'none';
      return undefined;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of shown) {
      const b = n.getBounds();
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const tl = toCss(app, minX, minY);
    const br = toCss(app, maxX, maxY);
    Object.assign(box.style, {
      display: 'block',
      left: `${tl.x}px`,
      top: `${tl.y}px`,
      width: `${br.x - tl.x}px`,
      height: `${br.y - tl.y}px`,
    });
    return { tl, br };
  }

  return {
    get dragging() {
      return !!drag;
    },

    setHover(entry: Entry | undefined) {
      hover = entry;
    },

    /** Press on the canvas over `node`; becomes a move once the pointer travels. */
    beginMove(e: PointerEvent, node: Container, onClick?: () => void) {
      const app = getApp();
      if (!app) return;
      flushNudge();
      drag = {
        kind: 'move',
        node,
        scope: moveScope(node),
        start: toStage(app, e.clientX, e.clientY),
        startX: node.x,
        startY: node.y,
        moved: false,
        onClick,
      };
    },

    /** Arrow keys: move right away, write once the keys go quiet. */
    nudge(dx: number, dy: number) {
      const node = session.node;
      if (!node) return;
      if (nudge && nudge.node !== node) flushNudge();
      nudge ??= { node, scope: moveScope(node), startX: node.x, startY: node.y, timer: 0 };
      clearTimeout(nudge.timer);
      node.position.set(node.x + dx, node.y + dy);
      for (const f of nudge.scope.followers) f.node.position.set(f.node.x + dx, f.node.y + dy);
      nudge.timer = window.setTimeout(flushNudge, NUDGE_COMMIT_MS);
    },

    /** Called every frame. */
    draw() {
      const entry = session.entry;
      place(hoverBox, hover && hover !== entry ? displayNodes(hover) : []);
      grid.draw(drag?.moved ? drag.node.parent : undefined, snapStep());
      const box = entry && place(outline, displayNodes(entry));
      label.style.display = handle.style.display = box ? 'block' : 'none';
      if (!box || !entry) return;
      if (!session.info) handle.style.display = 'none';
      Object.assign(handle.style, { left: `${box.br.x - 5}px`, top: `${box.br.y - 5}px` });

      const node = session.node;
      const name = entry.component ? `◆ ${entry.name}` : entry.name;
      label.textContent = drag?.moved && node ? dragReadout(node, drag) : `${name}  ${entry.src}`;
      const left = Math.min(box.tl.x, window.innerWidth - label.offsetWidth - 4);
      Object.assign(label.style, { left: `${Math.max(0, left)}px`, top: `${Math.max(0, box.tl.y - 22)}px` });
    },
  };
}

/**
 * A component's prop that is a literal or const: the same for every item, so an item's own
 * value can be derived from it (a component may map its props to positions any way it likes).
 */
function hasPlainNumber(info: ElementInfo, prop: string) {
  const edit = info.props.find((p) => p.name === prop)?.edit;
  return typeof edit?.value === 'number' && (edit.via === 'literal' || edit.via === 'const');
}

/** The value to write: the source's number moved by the live delta / ratio, or the live value. */
function fromSource(i: Item, base: number | undefined) {
  if (base === undefined) return i.to;
  if (i.mode === 'add') return base + (i.to - i.from);
  return i.from ? base * (i.to / i.from) : i.to;
}

type MoveDrag = Extract<Drag, { kind: 'move' }>;
type ResizeDrag = Extract<Drag, { kind: 'resize' }>;

/** Shift locks to the dominant axis. */
function moveTo(d: MoveDrag, p: Point, step: number, lockAxis: boolean) {
  const parent = d.node.parent;
  if (!parent) return;
  const a = parent.toLocal(d.start);
  const b = parent.toLocal(p);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (lockAxis && Math.abs(dx) > Math.abs(dy)) dy = 0;
  else if (lockAxis) dx = 0;
  d.node.position.set(dx === 0 ? d.startX : snap(d.startX + dx, step), dy === 0 ? d.startY : snap(d.startY + dy, step));
  for (const f of d.scope.followers) f.node.position.set(f.x + d.node.x - d.startX, f.y + d.node.y - d.startY);
}

/** Bottom-right handle; Shift keeps the aspect ratio in size mode (scale is always uniform). */
function resizeTo(d: ResizeDrag, p: Point, step: number, keepAspect: boolean) {
  let rx = Math.max(0.05, (d.boundsW + p.x - d.start.x) / d.boundsW);
  let ry = Math.max(0.05, (d.boundsH + p.y - d.start.y) / d.boundsH);
  if (d.mode === 'scale') {
    const r = (rx + ry) / 2;
    d.node.scale.set(round2(d.startSx * r), round2(d.startSy * r));
    return;
  }
  if (keepAspect) rx = ry = Math.max(rx, ry);
  d.node.width = Math.max(1, snap(d.startW * rx, step));
  d.node.height = Math.max(1, snap(d.startH * ry, step));
}

function revert(d: Drag) {
  if (d.kind === 'move') {
    d.node.position.set(d.startX, d.startY);
    for (const f of d.scope.followers) f.node.position.set(f.x, f.y);
  } else if (d.mode === 'size') {
    d.node.width = d.startW;
    d.node.height = d.startH;
  } else d.node.scale.set(d.startSx, d.startSy);
}

function dragReadout(node: Container, d: Drag) {
  if (d.kind === 'move') return `x ${round(node.x)}  y ${round(node.y)}`;
  if (d.mode === 'size') return `width ${round(node.width)}  height ${round(node.height)}`;
  return `scale ${round2(node.scale.x)}`;
}

function setProp(node: Container, prop: string, value: number) {
  (node as unknown as Record<string, number>)[prop] = value;
}

function snap(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : round(value);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function el(tag: 'div' | 'a', style: string): HTMLElement {
  const node = document.createElement(tag);
  node.style.cssText = style;
  return node;
}

const OUTLINE_STYLE =
  'position:fixed;z-index:2147483646;pointer-events:none;outline:2px solid #d6336c;background:rgba(214,51,108,.12);display:none';
const HOVER_STYLE = 'position:fixed;z-index:2147483646;pointer-events:none;outline:1px dashed #74c0fc;display:none';
const LABEL_STYLE =
  'position:fixed;z-index:2147483647;padding:2px 6px;font:11px monospace;color:#fff;background:#d6336c;white-space:nowrap;cursor:pointer;text-decoration:underline;display:none';
const HANDLE_STYLE =
  'position:fixed;z-index:2147483647;width:10px;height:10px;box-sizing:border-box;background:#fff;border:2px solid #d6336c;cursor:nwse-resize;touch-action:none;display:none';
