import type { Container } from 'pixi.js';
import { SRC_ATTR } from '../shared';

/** A display object rendered from a tagged pixi intrinsic; `__src` follows the source as Fast Refresh re-renders. */
export type Tagged = Container & { [SRC_ATTR]?: string };

export function srcOf(node: Container | undefined | null): string | undefined {
  return (node as Tagged | undefined)?.[SRC_ATTR];
}

export function round(n: number) {
  return Math.round(n * 1e4) / 1e4;
}
