import type { Container } from 'pixi.js';
import { getApp, toCss } from './viewport';

/** Snap grid overlay, drawn in a parent container's coordinate space while dragging. */
export function createGridOverlay() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483645;pointer-events:none';
  document.body.append(canvas);

  return {
    /** `parent` undefined or `step` 0 clears the grid. */
    draw(parent: Container | null | undefined, step: number) {
      const ctx = canvas.getContext('2d');
      const app = getApp();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== window.innerWidth * dpr || canvas.height !== window.innerHeight * dpr) {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
      }
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      if (!ctx || !app || !parent || step <= 0) return;

      // skip rotated/skewed parents
      const g0 = parent.toGlobal({ x: 0, y: 0 });
      const gx = parent.toGlobal({ x: step, y: 0 });
      const gy = parent.toGlobal({ x: 0, y: step });
      if (Math.abs(gx.y - g0.y) > 0.01 || Math.abs(gy.x - g0.x) > 0.01) return;
      const o = toCss(app, g0.x, g0.y);
      let sx = toCss(app, gx.x, gx.y).x - o.x;
      let sy = toCss(app, gy.x, gy.y).y - o.y;
      if (!(Math.abs(sx) > 0.01 && Math.abs(sy) > 0.01)) return; // zero/NaN scale: would never terminate below
      while (Math.abs(sx) < 8) sx *= 5; // too dense to see: draw every 5th line
      while (Math.abs(sy) < 8) sy *= 5;

      const r = app.canvas.getBoundingClientRect();
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.beginPath();
      ctx.rect(r.left, r.top, r.width, r.height);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = o.x + Math.ceil((r.left - o.x) / sx) * sx; x <= r.right; x += Math.abs(sx)) {
        ctx.moveTo(Math.round(x) + 0.5, r.top);
        ctx.lineTo(Math.round(x) + 0.5, r.bottom);
      }
      for (let y = o.y + Math.ceil((r.top - o.y) / sy) * sy; y <= r.bottom; y += Math.abs(sy)) {
        ctx.moveTo(r.left, Math.round(y) + 0.5);
        ctx.lineTo(r.right, Math.round(y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    },
  };
}
