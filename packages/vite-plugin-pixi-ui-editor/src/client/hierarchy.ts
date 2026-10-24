import type { PaletteItem, Placement } from '../shared';
import { fetchPalette } from './api';
import { commitVersion, displayNodes, type Entry, entryTree, file, isShown } from './fiber-index';
import { BUTTON_STYLE, h, INPUT_STYLE, loadedTextureKeys } from './inspector';
import { round } from './pixi-node';
import type { Session } from './session';

/** Re-render the tree at most this often while the app keeps committing. */
const REFRESH_MS = 400;
/** Levels expanded until the user collapses them. */
const DEFAULT_OPEN_DEPTH = 3;

interface HierarchyOptions {
  setHover(entry: Entry | undefined): void;
  openInEditor(src: string): void;
}

const keyOf = (e: { src: string; index: number }) => `${e.src}#${e.index}`;

/**
 * Left-hand panel: the JSX elements on screen as a tree (◆ = component call),
 * a filter, an "add element" form, and drag & drop to reorder / reparent
 * (top edge = before, bottom edge = after, middle = as child).
 */
export function createHierarchy(session: Session, { setHover, openInEditor }: HierarchyOptions) {
  const panel = h('div', { style: PANEL_STYLE, 'data-pixi-ui-editor': 'hierarchy' });
  const filter = h('input', {
    type: 'search',
    placeholder: 'Filter by name, label or file',
    style: INPUT_STYLE,
  }) as HTMLInputElement;
  const list = h('div', { style: 'overflow:auto;flex:1;min-height:0;margin-top:6px' });
  const adder = createAdder(session);
  panel.append(h('b', {}, ['Hierarchy']), adder, filter, list);
  document.body.append(panel);
  for (const type of ['keydown', 'keyup', 'keypress'] as const)
    panel.addEventListener(type, (e) => e.stopPropagation());

  const expanded = new Set<string>();
  const collapsed = new Set<string>();
  let renderedVersion = -1;
  let renderedSelection = '';
  let dragging: Entry | undefined;

  filter.oninput = () => render();
  session.subscribe(() => render());
  window.setInterval(() => {
    const selection = session.ref ? keyOf(session.ref) : '';
    if (commitVersion() !== renderedVersion || selection !== renderedSelection) render();
  }, REFRESH_MS);

  function render() {
    // replacing rows mid-drag would remove the row being dragged and cancel the drag
    if (dragging) return;
    renderedVersion = commitVersion();
    const selection = session.ref ? keyOf(session.ref) : '';
    const selectionChanged = selection !== renderedSelection;
    renderedSelection = selection;

    // open the path down to the selection
    for (let e = session.entry?.parent; e; e = e.parent) expanded.add(keyOf(e));

    const query = filter.value.trim().toLowerCase();
    const matches = (e: Entry) => [e.name, e.label ?? '', e.src].some((text) => text.toLowerCase().includes(query));
    const keep = (e: Entry): boolean => !query || matches(e) || e.children.some(keep);

    const scroll = list.scrollTop;
    const rows: HTMLElement[] = [];
    const visit = (entries: Entry[], depth: number) => {
      for (const e of entries) {
        if (!keep(e)) continue;
        const key = keyOf(e);
        const open = !!query || expanded.has(key) || (depth < DEFAULT_OPEN_DEPTH && !collapsed.has(key));
        rows.push(row(e, depth, open, key === selection));
        if (open) visit(e.children, depth + 1);
      }
    };
    visit(entryTree(), 0);
    list.replaceChildren(...rows);
    list.scrollTop = scroll;
    if (selectionChanged) list.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }

  function row(e: Entry, depth: number, open: boolean, selected: boolean) {
    const key = keyOf(e);
    const shown = displayNodes(e).some((n) => !n.destroyed && isShown(n));
    const where = `${file(e.src).split('/').pop()}:${e.src.split(':').at(-2)}`;
    let arrow = '';
    if (e.children.length) arrow = open ? '▾' : '▸';
    const toggle = h('span', { style: 'display:inline-block;width:12px;cursor:pointer;color:#888' }, [arrow]);
    const instance = e.index ? `  (instance ${e.index + 1})` : '';
    const r = h(
      'div',
      {
        style: `${ROW_STYLE};padding-left:${depth * 12 + 2}px;opacity:${shown ? 1 : 0.45};background:${selected ? '#5c1f3a' : 'transparent'}`,
        title: `${e.src}${instance}${shown ? '' : '  — currently hidden'}`,
        draggable: 'true',
        'data-src': e.src,
        'data-index': String(e.index),
      },
      [
        toggle,
        `${e.component ? '◆ ' : ''}${e.name}`,
        e.label ? h('span', { style: 'color:#f783ac' }, [` ${e.label}`]) : '',
        h('span', { style: 'color:#777' }, [`  ${where}`]),
      ],
    );
    if (selected) r.dataset.selected = '';

    toggle.onclick = (ev) => {
      ev.stopPropagation();
      if (open) {
        expanded.delete(key);
        collapsed.add(key);
      } else {
        collapsed.delete(key);
        expanded.add(key);
      }
      render();
    };
    r.onclick = () => session.select(e);
    r.ondblclick = () => openInEditor(e.src);
    r.onmouseenter = () => setHover(e);
    r.onmouseleave = () => setHover(undefined);

    r.ondragstart = (ev) => {
      dragging = e;
      ev.dataTransfer?.setData('text/plain', e.src);
    };
    r.ondragend = () => {
      dragging = undefined;
      render();
    };
    r.ondragover = (ev) => {
      if (!dragging || dragging === e) return;
      ev.preventDefault();
      const zone = zoneOf(ev, r);
      r.style.boxShadow = DROP_MARK[zone];
    };
    r.ondragleave = () => {
      r.style.boxShadow = '';
    };
    r.ondrop = (ev) => {
      ev.preventDefault();
      r.style.boxShadow = '';
      const from = dragging;
      dragging = undefined;
      if (!from || from === e) return render();
      if (file(from.src) !== file(e.src)) {
        session.setError(
          'Elements can only be moved within the same file (component); move across files in the source',
        );
        return render();
      }
      session.move(from.src, e.src, zoneOf(ev, r));
    };
    return r;
  }

  render();
}

function zoneOf(ev: DragEvent, row: HTMLElement): Placement {
  const r = row.getBoundingClientRect();
  const y = (ev.clientY - r.top) / r.height;
  if (y < 0.25) return 'before';
  if (y > 0.75) return 'after';
  return 'child';
}

/** "Add" form: element kind (+ texture for sprites / buttons), as child of / after the selection. */
function createAdder(session: Session) {
  const wrap = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0' });
  const kind = h('select', { style: `${INPUT_STYLE};width:auto;flex:1` }) as HTMLSelectElement;
  const texture = h('input', {
    placeholder: 'Texture key',
    list: 'pixi-ui-editor-textures',
    style: `${INPUT_STYLE};display:none`,
  }) as HTMLInputElement;
  const asChild = h('button', { style: BUTTON_STYLE, title: 'Add inside the selection (as its last child)' }, [
    '+ Child',
  ]);
  const after = h('button', { style: BUTTON_STYLE, title: 'Add after the selection (as a sibling)' }, ['+ After']);
  wrap.append(kind, asChild, after, texture);

  let palette: PaletteItem[] = [];
  fetchPalette().then(
    (items) => {
      palette = items;
      kind.replaceChildren(...items.map((p) => new Option(p.label, p.kind)));
      syncTexture();
    },
    (e: Error) => session.setError(e.message),
  );
  const syncTexture = () => {
    const needs = palette.find((p) => p.kind === kind.value)?.needsTexture;
    texture.style.display = needs ? 'block' : 'none';
    if (needs && !texture.value) texture.value = loadedTextureKeys()[0] ?? '';
  };
  kind.onchange = syncTexture;
  texture.onfocus = () => {
    // inspector owns the datalist; make sure it is filled
    const list = document.getElementById('pixi-ui-editor-textures');
    if (list && !list.childElementCount) list.replaceChildren(...loadedTextureKeys().map((k) => new Option(k)));
  };

  const add = (placement: Placement) => {
    const node = session.node;
    if (!session.info || !node)
      return session.setError(
        'Select an element on screen or in the Hierarchy first; the new element goes inside or after it',
      );
    // child: centre of the parent's own space; after: next to the selection
    const b = node.getLocalBounds();
    const pos =
      placement === 'child'
        ? { x: round((b.minX + b.maxX) / 2), y: round((b.minY + b.maxY) / 2) }
        : { x: round(node.x + 20), y: round(node.y + 20) };
    session.insert({ placement, kind: kind.value, texture: texture.value || undefined, ...pos });
  };
  asChild.onclick = () => add('child');
  after.onclick = () => add('after');
  return wrap;
}

const DROP_MARK: Record<Placement, string> = {
  before: 'inset 0 2px 0 #f783ac',
  after: 'inset 0 -2px 0 #f783ac',
  child: 'inset 0 0 0 1px #f783ac',
};

const PANEL_STYLE =
  'position:fixed;top:8px;left:8px;z-index:2147483647;width:270px;height:calc(100vh - 56px);display:flex;flex-direction:column;padding:10px;font:12px/1.4 monospace;color:#eee;background:rgba(24,24,28,.94);border:1px solid #d6336c;border-radius:6px;box-sizing:border-box;text-align:left';
const ROW_STYLE =
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding:1px 2px;border-radius:2px';
