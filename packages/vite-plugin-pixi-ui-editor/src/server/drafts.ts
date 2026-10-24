import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EditError } from './ast';

interface Draft {
  /** The file on disk when the draft started. */
  base: string;
  code: string;
}

export interface DraftHooks {
  /** What the app is served for `file` changed (an editor write, a discard): reload it. */
  reload?(file: string): void;
  /** The set of drafted files changed. */
  changed?(): void;
}

export type Drafts = ReturnType<typeof createDrafts>;

/**
 * Editor writes land here instead of on disk, until the user applies them.
 * The dev server serves a drafted file's text in place of the disk's (see the
 * plugin's `load` hook), so the app shows the draft through the usual HMR.
 *
 * A file changed on disk outside the editor (the IDE, git) drops its draft: the disk wins.
 */
export function createDrafts({ reload, changed }: DraftHooks = {}) {
  const drafts = new Map<string, Draft>();
  const disk = (file: string) => readFile(file, 'utf8').catch(() => undefined);

  /** Drops the draft if the disk no longer holds its base; true when it did. */
  async function stale(file: string) {
    const draft = drafts.get(file);
    if (!draft || (await disk(file)) === draft.base) return false;
    drafts.delete(file);
    changed?.();
    return true;
  }

  return {
    /** The text the editor works on: the draft, else the disk. */
    async read(file: string) {
      file = resolve(file);
      await stale(file);
      return drafts.get(file)?.code ?? readFile(file, 'utf8');
    },

    async write(file: string, code: string) {
      file = resolve(file);
      await stale(file);
      const base = drafts.get(file)?.base ?? (await readFile(file, 'utf8'));
      // back to what's on disk (undo to the start): nothing left to apply
      if (code === base) drafts.delete(file);
      else drafts.set(file, { base, code });
      reload?.(file);
      changed?.();
    },

    /** The draft text to serve for a module id, or undefined to load it from disk. */
    async served(id: string) {
      const file = resolve(id);
      if (!drafts.has(file) || (await stale(file))) return undefined;
      return drafts.get(file)?.code;
    },

    /** Call when a file changed on disk; drops its draft unless the editor wrote it. */
    diskChanged: (file: string) => stale(resolve(file)),

    has: (file: string) => drafts.has(resolve(file)),

    list() {
      return [...drafts].map(([file, { base, code }]) => ({ file, base, code }));
    },

    /**
     * Writes every draft to disk. If any file changed on disk since its draft
     * started, that draft is dropped and nothing is written.
     */
    async apply() {
      const files = [...drafts.keys()];
      const conflicts: string[] = [];
      for (const file of files) if (await stale(file)) conflicts.push(file);
      if (conflicts.length) {
        throw new EditError(
          `Changed on disk since you edited it; its draft was discarded:\n${conflicts.join('\n')}\nNothing was written.`,
        );
      }
      // the watcher may report a written file (and drop its draft) before the loop is done
      const writes = [...drafts].map(([file, { code }]) => [file, code] as const);
      for (const [file, code] of writes) await writeFile(file, code);
      drafts.clear();
      changed?.();
      return files;
    },

    discard() {
      const files = [...drafts.keys()];
      drafts.clear();
      files.forEach((file) => reload?.(file));
      changed?.();
      return files;
    },
  };
}
