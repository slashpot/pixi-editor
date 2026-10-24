import type { Container } from 'pixi.js';
import { SRC_ATTR } from '../shared';

/**
 * Maps the rendered Pixi scene back to the JSX that produced it, through the
 * React fiber tree of @pixi/react's reconciler.
 *
 * @pixi/react registers with React DevTools at load time; we install (or wrap)
 * that global hook first — the client script runs before the app's modules —
 * and keep every Pixi root it commits. From a root, fibers whose props carry
 * `__src` are the editor's "entries": pixi intrinsics and tagged component calls.
 */

interface Fiber {
  type: unknown;
  /** What the JSX named: for `memo(() => …)` the memo object (which carries displayName), not the inner arrow. */
  elementType: unknown;
  memoizedProps: Record<string, unknown> | null;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  alternate: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
  containerInfo: unknown;
}

/** One JSX element on screen. `index` tells apart several instances of one source line (a `.map`). */
export interface Entry {
  src: string;
  index: number;
  /** `pixiSprite`, or the component's name. */
  name: string;
  /** The element's `label` prop, when it is a plain string. */
  label?: string;
  component: boolean;
  fiber: Fiber;
  parent: Entry | undefined;
  children: Entry[];
}

export interface EntryRef {
  src: string;
  index: number;
}

const roots = new Set<FiberRoot>();
let version = 0;
let built:
  { version: number; list: Entry[]; byFiber: WeakMap<Fiber, Entry>; byNode: WeakMap<object, Entry> } | undefined;

export function installFiberHook() {
  const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= minimalHook();
  const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const previous = hook.onCommitFiberRoot as ((...args: unknown[]) => unknown) | undefined;
  hook.onCommitFiberRoot = function (this: unknown, id: unknown, root: FiberRoot, ...rest: unknown[]) {
    if (isContainer(root?.containerInfo)) {
      roots.add(root);
      version++;
    }
    return previous?.call(this, id, root, ...rest);
  };
}

/** Changes whenever React commits to a Pixi root. */
export const commitVersion = () => version;

/** All entries, depth-first in render order, as a forest. */
export function entryTree(): Entry[] {
  return index().list.filter((e) => !e.parent);
}

export function resolve(ref: EntryRef | undefined): Entry | undefined {
  if (!ref) return undefined;
  return index().list.find((e) => e.src === ref.src && e.index === ref.index);
}

/** Every entry rendered from the JSX at `src` (several inside a `.map`). */
export function instancesOf(src: string) {
  return index().list.filter((e) => e.src === src);
}

export function instanceCount(src: string) {
  return instancesOf(src).length;
}

/** A component called from more than one place in the source (a reusable widget such as a Button). */
export function isReused(entry: Entry) {
  if (!entry.component) return false;
  const type = entry.fiber.elementType;
  const sites = new Set(
    index()
      .list.filter((e) => e.component && e.fiber.elementType === type)
      .map((e) => e.src),
  );
  return sites.size > 1;
}

/** The entry for a fiber (or its alternate) — survives source lines shifting under it. */
export function entryOfFiber(fiber: Fiber) {
  const { byFiber } = index();
  return byFiber.get(fiber) ?? (fiber.alternate ? byFiber.get(fiber.alternate) : undefined);
}

/** Entries from the outermost down to the one rendering `node`. */
export function chainOf(node: Container): Entry[] {
  const chain: Entry[] = [];
  for (let e: Entry | undefined = index().byNode.get(node); e; e = e.parent) chain.unshift(e);
  return chain;
}

/** The Pixi objects an entry puts on stage: itself, or a component's top-level hosts. */
export function displayNodes(entry: Entry): Container[] {
  if (!entry.component) return isContainer(entry.fiber.stateNode) ? [entry.fiber.stateNode] : [];
  const out: Container[] = [];
  const visit = (f: Fiber | null) => {
    for (; f; f = f.sibling) {
      if (typeof f.type === 'string' && isContainer(f.stateNode)) out.push(f.stateNode);
      else visit(f.child);
    }
  };
  visit(entry.fiber.child);
  return out;
}

export function isShown(node: Container) {
  for (let n: Container | null = node; n; n = n.parent) if (!n.visible) return false;
  return true;
}

export function file(src: string) {
  return src.replace(/:\d+:\d+$/, '');
}

// ---------------------------------------------------------------------------

function index() {
  if (built?.version === version) return built;
  const list: Entry[] = [];
  const byFiber = new WeakMap<Fiber, Entry>();
  const byNode = new WeakMap<object, Entry>();
  const seen = new Map<string, number>();

  const walk = (fiber: Fiber | null, parent: Entry | undefined) => {
    for (let f = fiber; f; f = f.sibling) {
      const src = f.memoizedProps?.[SRC_ATTR];
      let here = parent;
      // memo(forwardRef(...)) yields nested fibers with the same props: keep one entry
      if (typeof src === 'string' && src !== parent?.src) {
        const host = typeof f.type === 'string';
        const n = seen.get(src) ?? 0;
        seen.set(src, n + 1);
        const label = f.memoizedProps?.label;
        here = {
          src,
          index: n,
          name: host ? (f.type as string) : componentName(f.elementType ?? f.type),
          label: typeof label === 'string' ? label : undefined,
          component: !host,
          fiber: f,
          parent,
          children: [],
        };
        parent?.children.push(here);
        list.push(here);
        byFiber.set(f, here);
      }
      // a host fiber maps its Pixi object to the innermost entry around it
      if (typeof f.type === 'string' && isContainer(f.stateNode) && here) byNode.set(f.stateNode, here);
      walk(f.child, here);
    }
  };
  for (const root of roots) {
    if (root.current) walk(root.current.child, undefined);
  }
  built = { version, list, byFiber, byNode };
  return built;
}

function componentName(type: unknown): string {
  const t = type as { displayName?: string; name?: string; render?: { name?: string }; type?: unknown } | null;
  return t?.displayName || t?.name || t?.render?.name || (t?.type ? componentName(t.type) : '') || 'Component';
}

function isContainer(value: unknown): value is Container {
  return !!value && typeof (value as Container).addChild === 'function' && Array.isArray((value as Container).children);
}

/** Enough of React DevTools' hook for renderers (and react-refresh) to register with. */
function minimalHook() {
  let nextId = 0;
  const renderers = new Map<number, unknown>();
  const noop = () => undefined;
  return {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      renderers.set(++nextId, renderer);
      return nextId;
    },
    onScheduleFiberRoot: noop,
    onCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onPostCommitFiberRoot: noop,
    checkDCE: noop,
  };
}
