import type { Page } from '@playwright/test';
import { Editor, expect, test } from '../tests/fixtures';

const SCENE = 'src/Scene.tsx';

/** A fake cursor and a caption bar: headless video shows neither the pointer nor anything outside the page. */
async function installOverlay(page: Page) {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement('style');
      style.textContent = `
        #rec-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px;
          border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid #fff;
          box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4);
          pointer-events: none; z-index: 2147483647; transition: transform .12s, background .12s; }
        #rec-cursor.down { transform: scale(.75); background: rgba(255,200,60,.8); }
        #rec-caption { position: fixed; left: 50%; top: 24px; transform: translateX(-50%);
          padding: 10px 22px; border-radius: 10px; background: rgba(15,15,20,.85); color: #fff;
          font: 600 24px/1.3 system-ui, sans-serif; pointer-events: none; z-index: 2147483646;
          opacity: 0; transition: opacity .25s; white-space: nowrap; }
        #rec-caption.on { opacity: 1; }
        #rec-caption code { font: 600 22px ui-monospace, Menlo, monospace; color: #ffd166; }`;
      document.head.append(style);
      const cursor = Object.assign(document.createElement('div'), { id: 'rec-cursor' });
      const caption = Object.assign(document.createElement('div'), { id: 'rec-caption' });
      document.body.append(cursor, caption);
      const opts = { capture: true, passive: true };
      window.addEventListener('pointermove', (e) => (cursor.style.translate = `${e.clientX}px ${e.clientY}px`), opts);
      window.addEventListener('pointerdown', () => cursor.classList.add('down'), opts);
      window.addEventListener('pointerup', () => cursor.classList.remove('down'), opts);
    };
    if (document.body) install();
    else document.addEventListener('DOMContentLoaded', install);
  });
}

const caption = (page: Page, html: string) =>
  page.evaluate((html) => {
    const el = document.getElementById('rec-caption')!;
    el.innerHTML = html;
    el.classList.toggle('on', !!html);
  }, html);

let pointer = { x: 640, y: 420 };

/** Moves the mouse along an eased path in real time, so the video shows a smooth motion. */
async function glide(page: Page, x: number, y: number, ms = 600) {
  const from = pointer;
  const frames = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  pointer = { x, y };
}

test('promo demo', async ({ page, demo }) => {
  await installOverlay(page);
  const editor = new Editor(page, demo);
  await editor.open();
  if (process.env.FREEZE_BG) {
    // a still backdrop keeps the GIF small: every animated pixel costs bytes in each frame
    await page.evaluate(() => {
      const app = globalThis.__PIXI_APP__!;
      const bg = app.stage.getChildByLabel('background', true)!;
      const swirl = (bg.filters as unknown as { resources: { swirlUniforms: { uniforms: { uTime: number } } } }[])[0];
      app.ticker.add(() => (swirl.resources.swirlUniforms.uniforms.uTime = 4), null, -100);
    });
  }
  await page.waitForTimeout(400);
  console.log(`START ${Date.now()}`);
  const center = async (label: string) => {
    const b = await editor.box(label);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const click = async (x: number, y: number) => {
    await glide(page, x, y, 500);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  };
  const drag = async (label: string, dx: number, dy: number, ms = 1100) => {
    const c = await center(label);
    await glide(page, c.x, c.y, 450);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await glide(page, c.x + dx, c.y + dy, ms);
    await page.waitForTimeout(150);
    await page.mouse.up();
  };

  await page.mouse.move(pointer.x, pointer.y);
  await page.waitForTimeout(1200);

  // 1. select the star: Hierarchy, Inspector and the outline light up
  await caption(page, 'Click to select');
  const star = await center('star');
  await click(star.x, star.y);
  await expect(editor.inspector).toContainText('pixiSprite');
  await page.waitForTimeout(900);

  // 2. drag it
  await caption(page, 'Drag to move');
  await drag('star', 0, -75);
  await editor.expectSource(SCENE, (code) => !code.includes("texture={Texture.from('star')} x={540} y={570}"));
  await page.waitForTimeout(700);

  // 3. a component call works the same way
  await drag('ace', -60, 0, 900);
  await page.waitForTimeout(800);

  // 4. drafts: nothing on disk yet
  await caption(page, 'Nothing touches your files yet…');
  const changes = editor.changes;
  await expect(changes).toContainText('unapplied');
  const cb = await changes.boundingBox();
  await glide(page, cb!.x + cb!.width / 2, cb!.y + cb!.height / 2, 700);
  await page.waitForTimeout(900);

  // 5. review the diff
  await caption(page, 'Review the diff');
  await page.mouse.down();
  await page.mouse.up();
  await expect(editor.review).toBeVisible();
  await page.waitForTimeout(3200);

  // 6. apply
  await caption(page, 'Apply → written to <code>Scene.tsx</code>');
  const apply = editor.review.getByRole('button', { name: 'Apply to source' });
  const ab = await apply.boundingBox();
  await click(ab!.x + ab!.width / 2, ab!.y + ab!.height / 2);
  await expect(editor.review).toBeHidden();
  await editor.expectFile(SCENE, (code) => !code.includes("texture={Texture.from('star')} x={540} y={570}"));
  await page.waitForTimeout(1600);

  // 7. the other direction: an edit in the IDE shows up live
  await caption(page, 'Edit in your IDE → updates live');
  await page.waitForTimeout(900);
  const code = await demo.read(SCENE);
  await demo.write(SCENE, code.replace('text="Pixi UI Editor"', 'text="Hello Pixi!"'));
  await expect.poll(() => editor.live('title', 'text')).toBe('Hello Pixi!');
  await page.waitForTimeout(1800);

  await caption(page, '<code>npm i -D vite-plugin-pixi-ui-editor</code>');
  await page.waitForTimeout(2200);
  console.log(`END ${Date.now()}`);
});
