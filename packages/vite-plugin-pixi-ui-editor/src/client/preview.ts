export type Preview = 'free' | 'portrait' | 'landscape';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

let box: Box | undefined;
let dispatching = false;
let rootSelector = '#root';

/** CSS selector of the element to box; falls back to the canvas' parent when nothing matches. */
export function setPreviewRoot(selector: string) {
  rootSelector = selector;
}

/**
 * Boxes the app's root element to 9:16 / 16:9 and makes `window.innerWidth/innerHeight`
 * report that box, so the app lays out as on such a device. Both are needed:
 * An app may seed `isPortrait` from the window size and then track the root element
 * (and reloads the page when the two disagree).
 *
 * Must run before the app's modules evaluate — the client script is injected at
 * the top of <head> for this.
 */
export function applyPreview(mode: Preview, reserve: { left: number; right: number; bottom: number }) {
  installWindowSizeOverride();
  const root = document.querySelector<HTMLElement>(rootSelector) ?? document.querySelector('canvas')?.parentElement;
  if (!root) return;
  root.dataset.pixiUiEditorStyle ??= root.style.cssText;

  if (mode === 'free') {
    box = undefined;
    root.style.cssText = root.dataset.pixiUiEditorStyle;
  } else {
    const availW = Math.max(200, realWidth() - reserve.left - reserve.right);
    const availH = Math.max(200, realHeight() - reserve.bottom);
    const ratio = mode === 'portrait' ? 9 / 16 : 16 / 9;
    const width = Math.floor(Math.min(availW, availH * ratio));
    const height = Math.floor(width / ratio);
    box = {
      left: reserve.left + Math.floor((availW - width) / 2),
      top: Math.floor((availH - height) / 2) + 8,
      width,
      height,
    };
    Object.assign(root.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${width}px`,
      height: `${height}px`,
      outline: '1px dashed #d6336c',
    });
  }
  dispatching = true;
  window.dispatchEvent(new Event('resize'));
  dispatching = false;
}

/** A real window resize (not ours) — callers re-apply the preview to the new space. */
export function isOwnResize() {
  return dispatching;
}

const realWidth = () => readReal('innerWidth');
const realHeight = () => readReal('innerHeight');

const originals = new Map<string, () => number>();

function readReal(prop: 'innerWidth' | 'innerHeight') {
  return originals.get(prop)?.call(window) ?? window[prop];
}

function installWindowSizeOverride() {
  if (originals.size) return;
  for (const prop of ['innerWidth', 'innerHeight'] as const) {
    const descriptor = findDescriptor(prop);
    if (!descriptor?.get || !descriptor.configurable) continue;
    originals.set(prop, descriptor.get);
    Object.defineProperty(window, prop, {
      configurable: true,
      get() {
        if (box) return prop === 'innerWidth' ? box.width : box.height;
        return descriptor.get!.call(window);
      },
    });
  }
}

function findDescriptor(prop: string) {
  for (let o: object | null = window; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, prop);
    if (d) return d;
  }
  return undefined;
}
