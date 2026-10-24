import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDrafts } from './drafts';

async function tempFile(content: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'pixi-ui-editor-')), 'a.tsx');
  await writeFile(file, content);
  return file;
}

describe('drafts', () => {
  it('keeps writes off the disk and serves them until applied', async () => {
    const file = await tempFile('v1');
    const reload = vi.fn();
    const drafts = createDrafts({ reload });
    expect(await drafts.served(file)).toBeUndefined();

    await drafts.write(file, 'v2');
    expect(reload).toHaveBeenCalledWith(file);
    expect(await readFile(file, 'utf8')).toBe('v1');
    expect(await drafts.read(file)).toBe('v2');
    expect(await drafts.served(file)).toBe('v2');
    expect(drafts.list()).toEqual([{ file, base: 'v1', code: 'v2' }]);

    expect(await drafts.apply()).toEqual([file]);
    expect(await readFile(file, 'utf8')).toBe('v2');
    expect(drafts.list()).toEqual([]);
  });

  it('discards back to the disk', async () => {
    const file = await tempFile('v1');
    const reload = vi.fn();
    const drafts = createDrafts({ reload });
    await drafts.write(file, 'v2');
    expect(drafts.discard()).toEqual([file]);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(await drafts.read(file)).toBe('v1');
    expect(await readFile(file, 'utf8')).toBe('v1');
  });

  it('forgets a draft written back to what the disk holds', async () => {
    const file = await tempFile('v1');
    const drafts = createDrafts();
    await drafts.write(file, 'v2');
    await drafts.write(file, 'v1');
    expect(drafts.list()).toEqual([]);
  });

  it('drops a draft when the file changes on disk', async () => {
    const file = await tempFile('v1');
    const changed = vi.fn();
    const drafts = createDrafts({ changed });
    await drafts.write(file, 'v2');
    await writeFile(file, 'from the IDE');
    expect(await drafts.diskChanged(file)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(await drafts.served(file)).toBeUndefined();
    expect(await drafts.read(file)).toBe('from the IDE');
  });

  it('writes nothing when a drafted file changed on disk before apply', async () => {
    const a = await tempFile('a1');
    const b = await tempFile('b1');
    const drafts = createDrafts();
    await drafts.write(a, 'a2');
    await drafts.write(b, 'b2');
    await writeFile(b, 'from the IDE');
    await expect(drafts.apply()).rejects.toThrow(/Nothing was written/);
    expect(await readFile(a, 'utf8')).toBe('a1');
    expect(await readFile(b, 'utf8')).toBe('from the IDE');
    // the other draft is still there to apply
    expect(drafts.list().map((d) => d.file)).toEqual([a]);
  });
});
