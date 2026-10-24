import { readFile, writeFile } from 'node:fs/promises';
import { EditError } from './ast';

interface Step {
  file: string;
  before: string;
  after: string;
}

const LIMIT = 200;

/**
 * Undo / redo for writes made through the editor (per dev-server process).
 * A step only reverts when the file still holds exactly what the editor wrote,
 * so it never clobbers an edit made in the IDE afterwards.
 */
export function createHistory() {
  const undo: Step[] = [];
  const redo: Step[] = [];

  async function step(from: Step[], to: Step[], label: string) {
    const last = from.at(-1);
    if (!last) throw new EditError(`Nothing to ${label}`);
    const [current, next] = label === 'undo' ? [last.after, last.before] : [last.before, last.after];
    if ((await readFile(last.file, 'utf8')) !== current) {
      from.length = 0;
      throw new EditError(`${last.file} was changed outside the editor; cannot ${label} (history cleared)`);
    }
    await writeFile(last.file, next);
    to.push(from.pop()!);
    return last.file;
  }

  return {
    async write(file: string, before: string, after: string) {
      if (before === after) return;
      await writeFile(file, after);
      undo.push({ file, before, after });
      if (undo.length > LIMIT) undo.shift();
      redo.length = 0;
    },
    undo: () => step(undo, redo, 'undo'),
    redo: () => step(redo, undo, 'redo'),
  };
}
