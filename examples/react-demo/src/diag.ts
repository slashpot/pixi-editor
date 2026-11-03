import type { Application } from 'pixi.js';
import { VARIANT } from './diagVariant';

/**
 * Crash diagnostics for the iPad Safari preview (diag branch only). Every event goes to the
 * dev server terminal (see diagLog() in vite.config.ts) and into a trail in localStorage, so
 * the next load can tell how the previous one ended: a crash leaves no `pagehide`.
 */

const KEY = 'pixi-diag-trail';
const TRAIL_SIZE = 40;
const params = new URLSearchParams(window.location.search);

/** The branch's experiment (src/diagVariant.ts); `?noswirl`, `?noaa` and `?nopixi` add to it. */
export const diagFlags = {
  noSwirl: VARIANT.noSwirl || params.has('noswirl'),
  noAntialias: VARIANT.noAntialias || params.has('noaa'),
  noPixi: VARIANT.noPixi || params.has('nopixi'),
};

type Entry = { t: number; event: string; data?: unknown };
type Trail = { id: string; startedAt: number; lastBeat: number; ended?: string; entries: Entry[] };

const trail: Trail = { id: Math.random().toString(36).slice(2, 8), startedAt: Date.now(), lastBeat: 0, entries: [] };

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(trail));
  } catch {
    // private mode or blocked storage: the terminal still gets everything
  }
}

/** Logs one event to the terminal, the console and the trail. */
export function mark(event: string, data?: unknown) {
  const entry = { t: Math.round(performance.now()), event, data };
  trail.entries = [...trail.entries, entry].slice(-TRAIL_SIZE);
  save();
  console.log('[diag]', event, data ?? '');
  try {
    void fetch('/__diag', { method: 'POST', body: JSON.stringify({ id: trail.id, ...entry }), keepalive: true }).catch(
      () => {},
    );
  } catch {
    // keepalive bodies are capped; losing one line is fine
  }
}

// ---- how did the previous load end?

const overlay = document.createElement('pre');
overlay.style.cssText =
  'position:fixed;top:4px;right:4px;z-index:2147483647;margin:0;padding:6px 8px;max-width:46vw;' +
  'font:11px/1.35 ui-monospace,monospace;color:#fff;background:rgb(0 0 0 / 0.7);border-radius:6px;' +
  'pointer-events:none;white-space:pre-wrap';
let overlayHead = '';

function readPrevious(): Trail | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Trail) : undefined;
  } catch {
    return undefined;
  }
}

const previous = readPrevious();
if (previous) {
  const lived = Math.round(((previous.lastBeat || previous.startedAt) - previous.startedAt) / 1000);
  const last = previous.entries.slice(-6).map((e) => `${e.event}${e.data ? ' ' + JSON.stringify(e.data) : ''}`);
  const verdict = previous.ended ? `ended: ${previous.ended}` : 'CRASHED (no pagehide)';
  overlayHead = `prev load ${previous.id}: ${verdict}, alive ${lived}s\n  ${last.join('\n  ')}\n`;
  // sent after boot below, so the terminal shows it under this load's id
}

// ---- this load

function probeWebGL() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) return { webgl2: false };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const result = {
    webgl2: true,
    gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return result;
}

const nav = navigator as Navigator & { deviceMemory?: number };
mark('boot', {
  ua: navigator.userAgent,
  dpr: window.devicePixelRatio,
  view: `${window.innerWidth}x${window.innerHeight}`,
  screen: `${screen.width}x${screen.height}`,
  cores: navigator.hardwareConcurrency,
  memoryGB: nav.deviceMemory,
  isolated: window.crossOriginIsolated,
  iframe: window.self !== window.top,
  variant: VARIANT.name,
  flags: diagFlags,
  hmr: !!import.meta.hot,
});
if (previous)
  mark('previous-load', { id: previous.id, ended: previous.ended ?? 'CRASHED', last: previous.entries.slice(-6) });
mark('webgl-probe', probeWebGL());

/** Called from App's onInit: what Pixi actually created. */
export function markPixi(app: Application) {
  const gl = (app.renderer as { gl?: WebGL2RenderingContext }).gl;
  mark('pixi-init', {
    renderer: app.renderer.name,
    resolution: app.renderer.resolution,
    canvas: `${app.canvas.width}x${app.canvas.height}`,
    antialias: gl?.getContextAttributes()?.antialias,
  });
}

// ---- events that end or break a page

addEventListener(
  'webglcontextlost',
  (e) => mark('webglcontextlost', { target: (e.target as Element).tagName }),
  true, // the event doesn't bubble, so catch it on the way down
);
addEventListener('webglcontextrestored', () => mark('webglcontextrestored'), true);
addEventListener('error', (e) => mark('error', { message: e.message, at: `${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', (e) => mark('unhandledrejection', { reason: String(e.reason) }));
document.addEventListener('visibilitychange', () => mark('visibility', document.visibilityState));
addEventListener('pageshow', (e) => mark('pageshow', { persisted: e.persisted }));
addEventListener('pagehide', (e) => {
  trail.ended = `pagehide (persisted: ${e.persisted})`;
  mark('pagehide', { persisted: e.persisted });
});

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', (p) => mark('vite:beforeFullReload', p));
  import.meta.hot.on('vite:ws:disconnect', () => mark('vite:ws:disconnect'));
  import.meta.hot.on('vite:ws:connect', () => mark('vite:ws:connect'));
  import.meta.hot.on('vite:error', (p) => mark('vite:error', { message: p.err.message }));
}

// ---- heartbeat: frames keep coming while the page is alive

let frames = 0;
let longestGap = 0;
let lastFrame = performance.now();
const onFrame = (now: number) => {
  frames++;
  longestGap = Math.max(longestGap, now - lastFrame);
  lastFrame = now;
  requestAnimationFrame(onFrame);
};
requestAnimationFrame(onFrame);

let beats = 0;
let framesAtLastSend = 0;
setInterval(() => {
  trail.lastBeat = Date.now();
  beats++;
  overlay.textContent = `[${VARIANT.name}]\n${overlayHead}this load ${trail.id}: ${beats}s, ${frames} frames, longest gap ${Math.round(longestGap)}ms`;
  if (!overlay.isConnected && document.body) document.body.append(overlay);
  if (beats % 3 === 0) {
    mark('beat', { frames, fps: Math.round((frames - framesAtLastSend) / 3), longestGapMs: Math.round(longestGap) });
    framesAtLastSend = frames;
    longestGap = 0;
  } else {
    save();
  }
}, 1000);
