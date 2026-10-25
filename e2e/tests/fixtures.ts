import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { pixiUiEditor } from 'vite-plugin-pixi-ui-editor';

export { expect };

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DEMO = join(REPO, 'examples/react-demo');

/** A private copy of examples/react-demo served by its own Vite dev server, so tests can let the editor write to it. */
export interface Demo {
  root: string;
  url: string;
  read(file: string): Promise<string>;
  write(file: string, code: string): Promise<void>;
  /** 1-based line of the first line in `file` containing `text`. */
  lineOf(file: string, text: string): Promise<number>;
}

export async function copyDemo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pixi-ui-editor-e2e-')));
  for (const entry of ['src', 'public', 'index.html', 'package.json']) {
    await cp(join(DEMO, entry), join(root, entry), { recursive: true });
  }
  await symlink(join(DEMO, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

export const test = base.extend<{ demo: Demo; editor: Editor }, { cacheDir: string }>({
  cacheDir: [
    async ({}, use, workerInfo) => {
      // under node_modules like Vite's default, so React plugins skip the pre-bundled deps
      const dir = join(DEMO, 'node_modules', `.vite-e2e-${workerInfo.workerIndex}`);
      await use(dir);
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    },
    { scope: 'worker' },
  ],

  demo: async ({ cacheDir }, use) => {
    const root = await copyDemo();
    const server = await createServer({
      configFile: false,
      root,
      cacheDir,
      logLevel: 'error',
      plugins: [react(), pixiUiEditor()],
      server: { port: 0, fs: { allow: [root, REPO] } },
    });
    await server.listen();
    const read = (file: string) => readFile(join(root, file), 'utf8');
    await use({
      root,
      url: server.resolvedUrls!.local[0],
      read,
      write: (file, code) => writeFile(join(root, file), code),
      lineOf: async (file, text) => (await read(file)).split('\n').findIndex((line) => line.includes(text)) + 1,
    });
    await server.close();
    await rm(root, { recursive: true, force: true });
  },

  editor: async ({ page, demo }, use) => {
    const editor = new Editor(page, demo);
    await editor.open();
    await use(editor);
  },
});

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Drives the editor overlay on the demo page. */
export class Editor {
  readonly hierarchy: Locator;
  readonly inspector: Locator;
  readonly toolbar: Locator;
  /** Every confirm() the editor showed. */
  readonly dialogs: string[] = [];
  /** How the next confirm() is answered. */
  answer = true;

  constructor(
    readonly page: Page,
    readonly demo: Demo,
  ) {
    this.hierarchy = page.locator('[data-pixi-ui-editor="hierarchy"]');
    this.inspector = page.locator('[data-pixi-ui-editor="inspector"]');
    this.toolbar = page.locator('[data-pixi-ui-editor="toolbar"]');
    // the editor asks before rewriting shared consts / expressions, moving a .map's items and deleting
    page.on('dialog', (dialog) => {
      this.dialogs.push(dialog.message());
      void (this.answer ? dialog.accept() : dialog.dismiss());
    });
  }

  async open() {
    await this.page.goto(`${this.demo.url}?editor`);
    await this.ready();
  }

  /** Reloads the page and waits for the editor and the app as `open` does. */
  async reload() {
    await this.page.reload();
    await this.ready();
  }

  private async ready() {
    await expect(this.row('title')).toBeVisible();
    // the Hierarchy can show before the demo's onInit publishes the app the helpers below read
    await this.page.waitForFunction(() => !!globalThis.__PIXI_APP__);
  }

  /** The Hierarchy row of the element with this `label` prop (the outermost, for a component passing it on). */
  row(label: string) {
    return this.hierarchy
      .locator('[data-src]')
      .filter({ hasText: new RegExp(`\\s${label}\\s`) })
      .first();
  }

  /** The inspector's input for a prop path (`x`, `style.fontSize`, `y@landscape`). */
  input(prop: string) {
    return this.inspector.locator(`[data-prop="${prop}"]`);
  }

  /** CSS-pixel bounds of the display object labelled `label`. */
  box(label: string): Promise<Box> {
    return this.page.evaluate((label) => {
      const app = globalThis.__PIXI_APP__!;
      const node = app.stage.getChildByLabel(label, true);
      if (!node) throw new Error(`no display object labelled ${label}`);
      const b = node.getBounds();
      const r = app.canvas.getBoundingClientRect();
      const k = app.canvas.width / r.width / app.renderer.resolution;
      return { x: r.left + b.x / k, y: r.top + b.y / k, width: b.width / k, height: b.height / k };
    }, label);
  }

  /** A live property of the display object labelled `label`. */
  live(label: string, prop: 'x' | 'y' | 'text') {
    return this.page.evaluate(
      ({ label, prop }) =>
        (globalThis.__PIXI_APP__!.stage.getChildByLabel(label, true) as unknown as Record<string, unknown>)[prop],
      { label, prop },
    );
  }

  async click(label: string) {
    const b = await this.box(label);
    await this.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  }

  /** Presses on the element's centre and drags by (dx, dy) CSS px; `whileHeld` runs before release. */
  async drag(label: string, dx: number, dy: number, whileHeld?: () => Promise<void>) {
    const b = await this.box(label);
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
    await this.page.mouse.move(x + dx, y + dy, { steps: 5 });
    await whileHeld?.();
    await this.page.mouse.up();
  }

  /** Selects through the Hierarchy and waits for the inspector to load the element's source. */
  async select(label: string) {
    await this.row(label).click();
    await expect(this.inspector).toBeVisible();
    await expect(this.inspector.locator('[data-prop]').first()).toBeVisible();
  }

  /** What the app is served for `file`: the editor's draft, else the file on disk. */
  async source(file: string) {
    const res = await this.page.request.get(`${this.demo.url}__pixi-ui-editor/drafts`, {
      headers: { 'x-pixi-ui-editor': '1' },
    });
    const drafts: { file: string; after: string }[] = await res.json();
    return drafts.find((d) => d.file === file)?.after ?? this.demo.read(file);
  }

  /** Waits until the source of `file` (draft or disk) satisfies `check`. */
  async expectSource(file: string, check: (code: string) => boolean) {
    await expect.poll(() => this.source(file).then(check)).toBe(true);
  }

  /** Waits until `file` on disk satisfies `check`. */
  async expectFile(file: string, check: (code: string) => boolean) {
    await expect.poll(() => this.demo.read(file).then(check)).toBe(true);
  }

  /** The toolbar's unapplied-changes button. */
  get changes() {
    return this.toolbar.locator('[data-drafts]');
  }

  /** The panel listing unapplied changes. */
  get review() {
    return this.page.locator('[data-pixi-ui-editor="review"]');
  }
}
