import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { pixiUiEditor } from 'vite-plugin-pixi-ui-editor';
import { copyDemo } from './fixtures';

test('a production build contains neither source tags nor the overlay', async () => {
  const root = await copyDemo();
  try {
    await build({ configFile: false, root, logLevel: 'error', plugins: [react(), pixiUiEditor()] });
    const assets = join(root, 'dist/assets');
    const files = (await readdir(assets)).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = await readFile(join(assets, file), 'utf8');
      expect(code, file).not.toContain('__src');
      expect(code, file).not.toContain('__pixi-ui-editor'); // the API the overlay calls
      expect(code, file).not.toContain('data-pixi-ui-editor'); // the overlay's panels
    }
    expect(await readFile(join(root, 'dist/index.html'), 'utf8')).not.toContain('virtual:pixi-ui-editor');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
