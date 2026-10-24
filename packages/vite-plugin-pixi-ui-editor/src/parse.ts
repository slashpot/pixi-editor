import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';

/**
 * Babel's parser and traverser, bundled into dist so users install nothing beyond
 * their own vite / pixi.js / @pixi/react.
 */

// @babel/traverse is CommonJS; depending on the interop it arrives as the function or as `{ default }`
export const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse;

/** Parses a .js/.jsx/.ts/.tsx module; throws a SyntaxError on invalid code. */
export function parseModule(code: string) {
  return babelParse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
}
