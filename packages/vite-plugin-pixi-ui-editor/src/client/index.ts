import type { ClientConfig } from '../shared';
import { chainOf, displayNodes, type Entry, type EntryRef, installFiberHook, isReused } from './fiber-index';
import { createGizmo } from './gizmo';
import { createHierarchy } from './hierarchy';
import { confirmRemove, createInspector } from './inspector';
import { setPreviewRoot } from './preview';
import { createReview } from './review';
import { createSession } from './session';
import { createToolbar } from './toolbar';
import { getApp, hitStack, installAppHook, toStage } from './viewport';

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * While select mode is on, the app never sees pointer input on its canvas:
 * a click selects a JSX element (clicking again drills into it), a drag moves the
 * current selection (or what's under the pointer), and the side panels show and
 * edit the element tree and props. Runs before the app's modules (see vite-plugin).
 */
export function start({ workspaceRoot, appRoot, queryParam, previewRoot }: ClientConfig) {
  if (!new URLSearchParams(window.location.search).has(queryParam)) return;
  // must happen before pixi.js / @pixi/react load, so they report apps and commits to us
  installFiberHook();
  installAppHook();
  setPreviewRoot(previewRoot);
  const pickOptions: PickOptions = { inApp: (e) => isUnder(e.src, appRoot), isWidget: isReused };

  const openInEditor = (src: string) => {
    const file = encodeURIComponent(`${workspaceRoot}/${src}`);
    void fetch(`/__open-in-editor?file=${file}`);
  };

  // the app (and document.body content) may not exist yet; build the UI on DOM ready
  const ready = () => {
    const session = createSession();
    createInspector(session, { openInEditor });
    const gizmo = createGizmo(session, { snapStep: () => toolbar.snapStep, openInEditor });
    createHierarchy(session, { setHover: gizmo.setHover, openInEditor });
    const toolbar = createToolbar({
      onSelectingChange: (on) => !on && session.select(undefined),
      undo: () => session.undo(),
      redo: () => session.redo(),
      review: () => review.open(),
    });
    const review = createReview(session, { onFiles: (files) => toolbar.setDrafts(files.length) });

    // window capture runs before Pixi's own listeners on the canvas / document;
    // stopPropagation (not Immediate) so the gizmo's window listeners still run
    const swallow = (e: PointerEvent) => {
      const app = getApp();
      if (!toolbar.selecting || !app || e.target !== app.canvas) return;
      e.stopPropagation();
      e.preventDefault();
      if (e.type !== 'pointerdown') return;

      const p = toStage(app, e.clientX, e.clientY);
      const top = hitStack(app, p).at(-1);
      const chain = top ? chainOf(top) : [];
      const pick = pickFromChain(chain, session.ref, pickOptions);
      const current = session.entry;
      // dragging anywhere over the selection moves it; a plain click picks / drills in
      const overCurrent = current && displayNodes(current).some((n) => n.getBounds().containsPoint(p.x, p.y));
      const target = overCurrent ? current : pick;
      if (!target) return session.select(undefined);
      if (target !== current) session.select(target);
      const node = displayNodes(target)[0];
      if (node) gizmo.beginMove(e, node, () => pick && pick !== target && session.select(pick));

      console.groupCollapsed(`[pixi-ui-editor] ${chain.length} JSX element(s) here, outer → inner`);
      chain.forEach((entry) => console.log(`${entry.component ? '◆ ' : ''}${entry.name}`, entry.src));
      console.groupEnd();
    };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) {
      window.addEventListener(type, swallow, { capture: true });
    }

    /** Editor shortcuts; true when the key was ours (the app must not see it). */
    const shortcut = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        if (e.shiftKey) session.redo();
        else session.undo();
        return true;
      }
      if (mod && key === 'y') return !!session.redo();
      if (mod && key === 's') {
        review.open();
        return true;
      }
      if (!session.ref) return false;
      if (mod && key === 'd') return !!session.duplicate();
      if (key === 'delete' || key === 'backspace') {
        confirmRemove(session);
        return true;
      }
      if (key === 'escape' && !gizmo.dragging) {
        session.select(undefined);
        return true;
      }
      const dir = ARROWS[e.key];
      if (!dir) return false;
      const step = e.shiftKey ? 10 : 1;
      gizmo.nudge(dir[0] * step, dir[1] * step);
      return true;
    };
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing || !toolbar.selecting || !shortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
    });

    // code → UI: after any HMR update (ours or the IDE's) re-read the selected element
    import.meta.hot?.on('vite:afterUpdate', () => setTimeout(() => session.refresh(), 150));

    const frame = () => {
      session.track();
      gizmo.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
}

export interface PickOptions {
  /** Written in the app being served (not a shared package elsewhere in the workspace). */
  inApp(entry: Entry): boolean;
  /** A reusable component whose internals a first click shouldn't reach into. */
  isWidget(entry: Entry): boolean;
}

/**
 * Which JSX element a click selects, given the chain under the pointer (outer → inner):
 * - clicking again inside the current selection drills one level deeper;
 * - otherwise, among elements written in the app, the outermost reusable component
 *   (so a click on a <Button> selects its call site rather than the Button's internals),
 *   or the innermost element when no such component is under the pointer.
 */
export function pickFromChain(
  chain: Entry[],
  current: EntryRef | undefined,
  { inApp, isWidget }: PickOptions,
): Entry | undefined {
  const i = current ? chain.findIndex((e) => e.src === current.src && e.index === current.index) : -1;
  if (i >= 0 && i < chain.length - 1) return chain[i + 1];
  const own = chain.filter(inApp);
  const candidates = own.length ? own : chain;
  return candidates.find(isWidget) ?? candidates.at(-1);
}

/** Whether a `__src` ("dir/file.tsx:1:2", workspace-relative) lies under `dir` ('' = anywhere). */
export function isUnder(src: string, dir: string) {
  return !dir || src.startsWith(`${dir}/`);
}
