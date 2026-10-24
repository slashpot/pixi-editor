import type { Application } from 'pixi.js';
import { srcOf, type Tagged } from './pixi-node';

declare global {
  // pixi.js declares __PIXI_APP_INIT__; this one is the devtools convention apps set themselves
  var __PIXI_APP__: Application | undefined;
}

const apps: Application[] = [];

/**
 * Collects every Pixi Application as it initializes, through the hook pixi.js v8 calls
 * for devtools (`globalThis.__PIXI_APP_INIT__`). Chains any hook already installed
 * (e.g. @pixi/devtools). Must run before the app's modules — the client is injected first.
 */
export function installAppHook() {
  const previous = globalThis.__PIXI_APP_INIT__;
  globalThis.__PIXI_APP_INIT__ = (app, version) => {
    if ('stage' in app) apps.push(app); // the hook's type also allows a bare Renderer
    previous?.(app, version);
  };
}

/**
 * The app being edited: the most recently initialized one that is still alive and on the
 * page (React may remount it), else `globalThis.__PIXI_APP__` set by the app itself.
 */
export function getApp(): Application | undefined {
  for (let i = apps.length - 1; i >= 0; i--) {
    if (isLive(apps[i])) return apps[i];
    apps.splice(i, 1);
  }
  const fallback = globalThis.__PIXI_APP__;
  return fallback && isLive(fallback) ? fallback : undefined;
}

function isLive(app: Application) {
  // a destroyed app has no renderer; reading `canvas` would throw
  return !!app.renderer && !!app.stage && app.canvas.isConnected;
}

export interface Point {
  x: number;
  y: number;
}

/** Client (CSS) px → Pixi global coords. Same mapping as EventSystem.mapPositionToPoint. */
export function toStage(app: Application, clientX: number, clientY: number): Point {
  const r = app.canvas.getBoundingClientRect();
  const k = app.canvas.width / r.width / app.renderer.resolution;
  return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
}

/** Pixi global coords → client (CSS) px. */
export function toCss(app: Application, x: number, y: number): Point {
  const r = app.canvas.getBoundingClientRect();
  const k = app.canvas.width / r.width / app.renderer.resolution;
  return { x: r.left + x / k, y: r.top + y / k };
}

/** Tagged objects whose bounds contain the point, in render order (last = topmost). */
export function hitStack(app: Application, p: Point): Tagged[] {
  const hits: Tagged[] = [];
  const visit = (node: Tagged) => {
    if (!node.visible) return;
    if (srcOf(node) && node.getBounds().containsPoint(p.x, p.y)) hits.push(node);
    for (const child of node.children) visit(child);
  };
  visit(app.stage);
  return hits;
}
