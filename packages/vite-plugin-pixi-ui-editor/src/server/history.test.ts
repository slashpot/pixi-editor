import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

async function tempFile(content: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'pixi-ui-editor-')), 'a.tsx');
  await writeFile(file, content);
  return file;
}

describe('history', () => {
  it('undoes and redoes editor writes in order', async () => {
    const file = await tempFile('v1');
    const h = createHistory();
    await h.write(file, 'v1', 'v2');
    await h.write(file, 'v2', 'v3');
    await h.undo();
    expect(await readFile(file, 'utf8')).toBe('v2');
    await h.undo();
    expect(await readFile(file, 'utf8')).toBe('v1');
    await h.redo();
    expect(await readFile(file, 'utf8')).toBe('v2');
  });

  it('refuses to undo over a change made outside the editor', async () => {
    const file = await tempFile('v1');
    const h = createHistory();
    await h.write(file, 'v1', 'v2');
    await writeFile(file, 'edited in IDE');
    await expect(h.undo()).rejects.toThrow(/outside the editor/);
    expect(await readFile(file, 'utf8')).toBe('edited in IDE');
  });

  it('a new write clears redo', async () => {
    const file = await tempFile('v1');
    const h = createHistory();
    await h.write(file, 'v1', 'v2');
    await h.undo();
    await h.write(file, 'v1', 'v3');
    await expect(h.redo()).rejects.toThrow(/Nothing to redo/);
  });
});
