import { Cache, Texture } from 'pixi.js';
import type { Orientation, PropInfo, PropValue, ValueEdit } from '../shared';
import { type Entry, instanceCount } from './fiber-index';
import { currentOrientation } from './plan-edits';
import { round } from './pixi-node';
import type { Session } from './session';

/** Props offered by "Add prop" when the element doesn't set them yet. */
const ADDABLE = ['x', 'y', 'alpha', 'scale', 'angle', 'visible'] as const;
const SIDE_LABEL: Record<Orientation, string> = { portrait: 'Portrait', landscape: 'Landscape' };

interface InspectorOptions {
  openInEditor(src: string): void;
}

/**
 * Right-hand panel listing the selected element's JSX props. Editable values
 * are written back to the .tsx through the session; Vite HMR then updates the
 * app, and the session re-reads the source after every HMR update, so edits
 * made in the IDE show up here too.
 */
export function createInspector(session: Session, { openInEditor }: InspectorOptions) {
  const panel = h('div', { style: PANEL_STYLE, 'data-pixi-ui-editor': 'inspector' });
  const textureKeys = h('datalist', { id: 'pixi-ui-editor-textures' });
  document.body.append(panel, textureKeys);

  // keep typing in the panel away from the app's keyboard shortcuts
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    panel.addEventListener(type, (e) => e.stopPropagation());
  }

  const commit = (prop: string, value: PropValue, branch?: Orientation) => {
    session.commit([{ prop, value, branch }]); // never rejects; errors land in session.error
  };
  session.subscribe(render);

  function render() {
    const { entry, info, error, ref } = session;
    const focused = panel.contains(document.activeElement) ? fieldState(document.activeElement) : undefined;
    panel.replaceChildren();
    panel.style.display = ref ? 'block' : 'none';
    if (!ref) return;

    const crumbs = h('div', { style: 'margin-bottom:6px;line-height:1.6' });
    const chain: Entry[] = [];
    for (let e = entry?.parent; e; e = e.parent) chain.unshift(e);
    for (const ancestor of chain.slice(-4)) {
      const link = h('a', { style: LINK_STYLE, title: ancestor.src }, [ancestor.name]);
      link.onclick = () => session.select(ancestor);
      crumbs.append(link, ' › ');
    }
    crumbs.append(h('b', {}, [`${entry?.component ? '◆ ' : ''}${info?.tag ?? entry?.name ?? '…'}`]));
    const instances = instanceCount(ref.src);
    if (instances > 1) {
      crumbs.append(
        h(
          'span',
          {
            style: 'color:#fa5',
            title: 'This JSX renders several objects in a loop; editing a prop changes all of them',
          },
          [`  ×${instances}`],
        ),
      );
    }

    const file = h('a', { style: `${LINK_STYLE};word-break:break-all`, title: 'Open in editor' }, [ref.src]);
    file.onclick = () => openInEditor(ref.src);

    const table = h('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center' });
    for (const prop of info?.props ?? []) table.append(...rows(prop, prop.name, 0));

    panel.append(crumbs, file, actions(), h('hr', { style: HR_STYLE }), table, addRow());
    if (error) panel.append(h('div', { style: ERROR_STYLE, 'data-error': '' }, [error]));

    const input = focused && panel.querySelector<HTMLInputElement>(`[data-prop="${CSS.escape(focused.prop)}"]`);
    if (input) {
      input.focus();
      if (input.type !== 'text') return;
      // a refresh landing mid-typing (e.g. the HMR of the previous edit) keeps the draft and the
      // selection, unless the source changed this very field
      if (focused.edited && input.dataset.shown === focused.shown) input.value = focused.value;
      if (input.value === focused.value) input.setSelectionRange(focused.start, focused.end);
      else input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function actions() {
    const bar = h('div', { style: 'display:flex;gap:6px;margin-top:6px' });
    const movable = !!session.info?.movable;
    const why = movable
      ? ''
      : 'This element is not a direct child of another JSX element (conditional, loop, or top of a return)';
    const dup = h('button', { style: BUTTON_STYLE, title: why || 'Ctrl/Cmd+D' }, ['Duplicate']) as HTMLButtonElement;
    const del = h('button', { style: BUTTON_STYLE, title: why || 'Delete' }, ['Delete']) as HTMLButtonElement;
    dup.disabled = del.disabled = !movable;
    dup.style.opacity = del.style.opacity = movable ? '1' : '0.4';
    dup.onclick = () => session.duplicate();
    del.onclick = () => confirmRemove(session);
    bar.append(dup, del);
    return bar;
  }

  /** One prop → grid cells; object props expand into indented field rows. */
  function rows(prop: PropInfo, path: string, depth: number): Node[] {
    const label = h('span', { style: `color:#aaa;padding-left:${depth * 12}px;white-space:nowrap` }, [prop.name]);

    if (prop.fields) {
      let note: Node | string = depth ? '' : '{ … }';
      if (prop.objectConst) note = constNote(prop.objectConst.name, prop.objectConst.refs);
      const head = [label, h('span', { style: 'color:#888' }, [note])];
      return [...head, ...prop.fields.flatMap((f) => rows(f, `${path}.${f.name}`, depth + 1))];
    }
    if (prop.branch) return [label, branchCell(path, prop.branch)];
    if (prop.edit) return [label, valueCell(path, prop.edit)];

    const live = prop.name === '...' ? undefined : liveValue(path);
    const cell = codeCell(prop.code);
    if (live !== undefined) cell.append(h('span', { style: 'color:#6cf' }, [`  = ${live}`]));
    return [label, cell];
  }

  /** `isPortrait ? a : b` → one row per side, the current orientation highlighted. */
  function branchCell(path: string, branch: NonNullable<PropInfo['branch']>) {
    const current = currentOrientation();
    const cell = h('span', { style: 'display:grid;grid-template-columns:auto 1fr;gap:2px 4px;align-items:center' });
    for (const side of ['portrait', 'landscape'] as const) {
      const s = branch[side];
      const color = side === current ? '#f783ac' : '#666';
      const tag = h('span', { style: `color:${color}`, title: `${branch.test} → ${side}` }, [SIDE_LABEL[side]]);
      cell.append(tag, s.edit ? valueCell(path, s.edit, side) : codeCell(s.code));
    }
    if (branch.viaConst) {
      cell.append(h('span', {}, []), constNote(branch.viaConst.name, branch.viaConst.refs));
    }
    return cell;
  }

  function valueCell(path: string, edit: ValueEdit, branch?: Orientation) {
    const cell = h('span', { style: 'display:flex;gap:6px;align-items:center;min-width:0' });
    cell.append(control(path, edit.value, edit.via === 'texture', branch));
    if (edit.via === 'const') cell.append(constNote(edit.constName ?? '', edit.constRefs ?? 1));
    if (edit.via === 'texture') cell.append(h('span', { style: 'color:#888' }, ['texture']));
    if (edit.via === 'offset') {
      cell.append(h('span', { style: OFFSET_STYLE, title: `The number term of ${edit.expr}` }, [`in ${edit.expr}`]));
    }
    return cell;
  }

  function control(path: string, value: PropValue, isTexture: boolean, branch?: Orientation): HTMLElement {
    const key = branch ? `${path}@${branch}` : path;
    if (typeof value === 'boolean') {
      const box = h('input', { type: 'checkbox', 'data-prop': key }) as HTMLInputElement;
      box.checked = value;
      box.onchange = () => commit(path, box.checked, branch);
      return box;
    }

    const input = h('input', { type: 'text', 'data-prop': key, style: INPUT_STYLE }) as HTMLInputElement;
    input.value = String(value);
    input.dataset.shown = input.value;
    if (isTexture) {
      input.setAttribute('list', textureKeys.id);
      input.onfocus = fillTextureKeys;
    }

    const submit = () => {
      if (input.value === String(value)) return;
      if (typeof value === 'string') return commit(path, input.value, branch);
      const n = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(n))
        return session.setError(`${path}: "${input.value}" is not a number`);
      commit(path, n, branch);
    };
    input.onblur = submit;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') input.value = String(value);
      if (typeof value !== 'number' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const current = Number(input.value);
      const base = Number.isFinite(current) ? current : value;
      input.value = String(round(base + (e.key === 'ArrowUp' ? 1 : -1) * stepFor(path, value) * (e.shiftKey ? 10 : 1)));
      submit();
    };
    return input;
  }

  function addRow() {
    const { node, info } = session;
    const present = new Set(info?.props.map((p) => p.name));
    const missing = ADDABLE.filter((p) => !present.has(p));
    if (!info || !node || missing.length === 0) return '';

    const picker = h(
      'select',
      { style: INPUT_STYLE },
      missing.map((p) => h('option', { value: p }, [p])),
    ) as HTMLSelectElement;
    const button = h('button', { style: BUTTON_STYLE }, ['Add prop']);
    button.onclick = () => {
      const prop = picker.value as (typeof ADDABLE)[number];
      const live = session.node;
      if (!live) return;
      // start from the live value so the object stays where it is
      let value: PropValue;
      if (prop === 'scale') value = round(live.scale.x);
      else if (prop === 'visible') value = live.visible;
      else value = round(live[prop]);
      commit(prop, value);
    };
    return h('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [picker, button]);
  }

  /** What `path` evaluates to on the live object (`anchor.x` → node.anchor.x). */
  function liveValue(path: string): string | undefined {
    let value: unknown = session.node;
    for (const key of path.split('.')) value = (value as Record<string, unknown> | undefined)?.[key];
    if (typeof value === 'number') return String(round(value));
    if (typeof value === 'string' || typeof value === 'boolean') return String(value);
    if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
      const { x, y } = value as { x: number; y: number };
      return `(${round(x)}, ${round(y)})`;
    }
    return undefined;
  }

  function fillTextureKeys() {
    if (textureKeys.childElementCount) return;
    textureKeys.replaceChildren(...loadedTextureKeys().map((k) => h('option', { value: k })));
  }
}

/** alpha / scale / anchor-like values step by 0.1, everything else by 1. */
function stepFor(path: string, value: number) {
  if (/(^|\.)(alpha|scale)$/.test(path)) return 0.1;
  if (/(^|\.)(anchor|pivot)(\.[xy])?$/.test(path) && Math.abs(value) <= 1) return 0.1;
  return 1;
}

/** Texture keys currently in Pixi's cache (spritesheet frames included). */
export function loadedTextureKeys() {
  // Cache has no public key listing; this is a dev-only peek at loaded textures
  const cache = (Cache as unknown as { _cache: Map<unknown, unknown> })._cache;
  return [...cache]
    .filter(([k, v]) => typeof k === 'string' && !k.includes('/') && v instanceof Texture)
    .map(([k]) => k as string)
    .sort();
}

export function confirmRemove(session: Session) {
  const name = session.info?.tag ?? session.entry?.name ?? 'element';
  if (session.info?.movable && window.confirm(`Delete <${name}>?\n${session.ref?.src}\n\n(Ctrl/Cmd+Z to undo)`)) {
    session.remove();
  }
}

function constNote(name: string, refs: number) {
  const shared = refs > 1;
  return h(
    'span',
    {
      style: `color:${shared ? '#fa5' : '#888'};white-space:nowrap`,
      title: 'Edits the const declaration in this file',
    },
    [shared ? `const ${name} · shared by ${refs}` : `const ${name}`],
  );
}

function codeCell(code: string) {
  return h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0', title: code }, [
    h('code', { style: 'color:#888' }, [code]),
  ]);
}

/** What the focused field holds before a re-render replaces it. */
function fieldState(el: Element | null) {
  if (!(el instanceof HTMLInputElement) || !el.dataset.prop) return undefined;
  const text = el.type === 'text';
  return {
    prop: el.dataset.prop,
    value: el.value,
    shown: el.dataset.shown,
    edited: text && el.value !== el.dataset.shown,
    start: (text && el.selectionStart) || 0,
    end: (text && el.selectionEnd) || 0,
  };
}

export function h(tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const PANEL_STYLE =
  'position:fixed;top:8px;right:8px;z-index:2147483647;width:330px;max-height:calc(100vh - 56px);overflow:auto;padding:10px;font:12px/1.4 monospace;color:#eee;background:rgba(24,24,28,.94);border:1px solid #d6336c;border-radius:6px;box-sizing:border-box;text-align:left;display:none';
const LINK_STYLE = 'color:#f783ac;cursor:pointer;text-decoration:underline';
export const INPUT_STYLE =
  'width:100%;min-width:0;box-sizing:border-box;padding:2px 4px;font:12px monospace;color:#fff;background:#333;border:1px solid #555;border-radius:3px';
export const BUTTON_STYLE =
  'white-space:nowrap;padding:2px 8px;font:12px monospace;color:#fff;background:#d6336c;border:0;border-radius:3px;cursor:pointer';
const OFFSET_STYLE = 'color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1';
const HR_STYLE = 'border:0;border-top:1px solid #444;margin:8px 0';
const ERROR_STYLE =
  'margin-top:8px;padding:4px 6px;color:#fff;background:#a61e4d;border-radius:3px;white-space:pre-wrap';
