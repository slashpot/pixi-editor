import type { Container } from 'pixi.js';
import type { ElementInfo, InsertRequest, Placement, PropEdit } from '../shared';
import * as api from './api';
import { displayNodes, type Entry, type EntryRef, entryOfFiber, resolve } from './fiber-index';

export type Session = ReturnType<typeof createSession>;

/**
 * What is selected (a JSX element, by source location + instance index) and what
 * the source says about it. Inspector, gizmo and hierarchy all change the source
 * through here; requests run one at a time so each carries the file hash
 * returned by the previous one.
 */
export function createSession() {
  let ref: EntryRef | undefined;
  /** Remembered so the selection survives its source lines shifting (IDE edits above it). */
  let lastEntry: Entry | undefined;
  let info: ElementInfo | undefined;
  /** The read started by the latest selection change. */
  let selecting: Promise<void> = Promise.resolve();
  let error = '';
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  async function load(force = false) {
    const src = ref?.src;
    if (!src) return notify();
    try {
      const next = await api.fetchElement(src);
      if (ref?.src !== src) return; // selection moved on while loading
      const changed = force || next.hash !== info?.hash || next.src !== info?.src;
      info = next;
      error = '';
      if (changed) notify();
    } catch (e) {
      error = (e as Error).message;
      notify();
    }
  }

  /** Runs a write after the previous one; failures land in `error`. Resolves true on success. */
  function enqueue(run: (current: ElementInfo) => Promise<void>, needsInfo = true): Promise<boolean> {
    const done = queue.then(async () => {
      if (needsInfo && !info) return false;
      try {
        await run(info!);
        error = '';
        return true;
      } catch (e) {
        error = (e as Error).message;
        if (e instanceof api.ApiError && e.status === 409) await load(true);
        return false;
      } finally {
        notify();
      }
    });
    queue = done;
    return done;
  }

  function select(next: EntryRef | undefined) {
    if (next?.src === ref?.src && next?.index === ref?.index) return;
    ref = next && { src: next.src, index: next.index };
    lastEntry = resolve(ref);
    info = undefined;
    error = '';
    notify();
    selecting = load(true);
  }

  return {
    get ref() {
      return ref;
    },
    get entry(): Entry | undefined {
      return resolve(ref);
    },
    /** The Pixi object to outline / drag: the element itself, or a component's root. */
    get node(): Container | undefined {
      const entry = resolve(ref);
      return entry ? displayNodes(entry)[0] : undefined;
    },
    get info() {
      return info;
    },

    /** The selection's source once its read is done (undefined if that failed or nothing is selected). */
    async loaded() {
      await selecting;
      return info;
    },
    get error() {
      return error;
    },

    select,

    /**
     * Called every frame: if the selected source line moved (an edit above it),
     * follow the same React instance to its new `src`.
     */
    track() {
      const entry = resolve(ref);
      if (entry) {
        lastEntry = entry;
        return;
      }
      const moved = lastEntry && entryOfFiber(lastEntry.fiber);
      if (moved && ref && moved.src !== ref.src) {
        ref = { src: moved.src, index: moved.index };
        lastEntry = moved;
        void load(true);
      }
    },

    /** Re-read the source (after HMR). */
    refresh: () => void load(),

    commit(edits: PropEdit[]) {
      if (edits.length === 0) return Promise.resolve(false);
      return enqueue(async (current) => {
        info = await api.editElement({ src: current.src, hash: current.hash, edits });
      });
    },

    insert(req: Omit<InsertRequest, 'src' | 'hash'>) {
      return enqueue(async (current) => {
        const made = await api.insertElement({ ...req, src: current.src, hash: current.hash });
        select({ src: made.src, index: 0 });
      });
    },

    duplicate() {
      return enqueue(async (current) => {
        const made = await api.duplicateElement({ src: current.src, hash: current.hash });
        select({ src: made.src, index: 0 });
      });
    },

    /** Moves the element at `from` (not necessarily the selection) next to / into `target`. */
    move(from: string, target: string, placement: Placement) {
      return enqueue(async () => {
        const { hash } = await api.fetchElement(from);
        const moved = await api.moveElement({ src: from, hash, target, placement });
        select({ src: moved.src, index: 0 });
      }, false);
    },

    remove() {
      return enqueue(async (current) => {
        await api.removeElement({ src: current.src, hash: current.hash });
        select(undefined);
      });
    },

    undo: () => enqueue(() => api.undo().then(() => load(true)), false),
    redo: () => enqueue(() => api.redo().then(() => load(true)), false),

    setError(message: string) {
      error = message;
      notify();
    },

    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
