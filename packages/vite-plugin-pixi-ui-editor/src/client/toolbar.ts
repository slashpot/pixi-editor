import { applyPreview as boxRoot, isOwnResize, type Preview } from './preview';

const TOGGLE_KEY = 'F2';
const STORAGE_KEY = 'pixi-ui-editor:toolbar';
const SNAP_STEPS = [0, 1, 5, 10, 20, 50];

interface Settings {
  snap: number;
  preview: Preview;
}

interface ToolbarOptions {
  onSelectingChange(selecting: boolean): void;
  undo(): void;
  redo(): void;
}

/**
 * Bottom-right bar: undo / redo, select-mode toggle (F2), snap step, and orientation preview
 * (see preview.ts). Snap and preview are remembered per browser, so an app that
 * reloads on orientation change comes back in the chosen preview.
 */
export function createToolbar({ onSelectingChange, undo, redo }: ToolbarOptions) {
  const settings = loadSettings();
  let selecting = true;

  const bar = document.createElement('div');
  bar.style.cssText = BAR_STYLE;
  bar.dataset.pixiUiEditor = 'toolbar';
  bar.addEventListener('keydown', (e) => e.stopPropagation());

  const toggle = document.createElement('button');
  toggle.style.cssText = BUTTON_STYLE;
  toggle.onclick = () => setSelecting(!selecting);

  const snap = select(
    'Snap',
    SNAP_STEPS.map((s) => [String(s), s === 0 ? 'off' : `${s}px`]),
    String(settings.snap),
    (v) => {
      settings.snap = Number(v);
      saveSettings(settings);
    },
  );
  const preview = select(
    'Preview',
    [
      ['free', 'Free'],
      ['portrait', 'Portrait 9:16'],
      ['landscape', 'Landscape 16:9'],
    ],
    settings.preview,
    (v) => {
      settings.preview = v as Preview;
      saveSettings(settings);
      applyPreview(settings.preview);
    },
  );
  const undoButton = button('↶', 'Undo (Ctrl/Cmd+Z)', undo);
  const redoButton = button('↷', 'Redo (Ctrl/Cmd+Shift+Z)', redo);
  bar.append(undoButton, redoButton, toggle, snap, preview);
  document.body.append(bar);

  window.addEventListener('keydown', (e) => {
    if (e.key === TOGGLE_KEY) setSelecting(!selecting);
  });
  window.addEventListener('resize', () => {
    if (!isOwnResize() && settings.preview !== 'free') applyPreview(settings.preview);
  });
  applyPreview(settings.preview);
  setSelecting(true);

  function applyPreview(mode: Preview) {
    // leave room for the hierarchy (left), inspector (right) and this bar (bottom)
    boxRoot(mode, { left: 290, right: 350, bottom: 56 });
  }

  function setSelecting(on: boolean) {
    selecting = on;
    toggle.textContent = `Select ${on ? 'ON' : 'OFF'} (${TOGGLE_KEY})`;
    toggle.style.opacity = on ? '1' : '0.5';
    onSelectingChange(on);
  }

  return {
    get selecting() {
      return selecting;
    },
    get snapStep() {
      return settings.snap;
    },
  };
}

function button(text: string, title: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.style.cssText = BUTTON_STYLE;
  b.onclick = onClick;
  return b;
}

function select(label: string, options: string[][], value: string, onChange: (v: string) => void) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
  const input = document.createElement('select');
  input.style.cssText = SELECT_STYLE;
  for (const [v, text] of options) input.append(new Option(text, v, false, v === value));
  input.onchange = () => onChange(input.value);
  wrap.append(label, input);
  return wrap;
}

function loadSettings(): Settings {
  const defaults: Settings = { snap: 0, preview: 'free' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode): settings just won't persist
  }
}

const BAR_STYLE =
  'position:fixed;right:8px;bottom:8px;z-index:2147483647;display:flex;gap:10px;align-items:center;padding:4px 8px;font:12px monospace;color:#fff;background:rgba(24,24,28,.94);border:1px solid #d6336c;border-radius:4px;user-select:none';
const BUTTON_STYLE =
  'padding:2px 8px;font:12px monospace;color:#fff;background:#d6336c;border:0;border-radius:3px;cursor:pointer';
const SELECT_STYLE = 'font:12px monospace;color:#fff;background:#333;border:1px solid #555;border-radius:3px';
