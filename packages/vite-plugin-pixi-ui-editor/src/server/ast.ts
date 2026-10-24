import { createHash } from 'node:crypto';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import { parseModule, traverse } from '../parse';

export class EditError extends Error {}

/** Change detection only, not security: just has to differ when the file does. */
export function hashOf(code: string) {
  return createHash('sha256').update(code).digest('hex').slice(0, 12);
}

export function parse(code: string, filename: string) {
  try {
    return parseModule(code);
  } catch (e) {
    throw new EditError(`Cannot parse ${filename}: ${(e as Error).message}`);
  }
}

/** The JSX opening tag at line:col (1-based column, as in `__src`). */
export function findElement(code: string, filename: string, line: number, col: number) {
  const ast = parse(code, filename);
  let found: NodePath<t.JSXOpeningElement> | undefined;
  traverse(ast, {
    JSXOpeningElement(path) {
      const loc = path.node.loc?.start;
      if (loc?.line === line && loc.column + 1 === col) {
        found = path;
        path.stop();
      }
    },
  });
  if (!found) throw new EditError(`No JSX element at ${filename}:${line}:${col} (the file may have changed)`);
  return found;
}

/** A number or boolean as source text; numbers are rounded to 4 decimals. */
export function formatNumberOrBool(value: number | boolean) {
  if (typeof value === 'boolean') return String(value);
  if (!Number.isFinite(value)) throw new EditError(`Not a valid number: ${value}`);
  return String(Math.round(value * 1e4) / 1e4);
}

export function tagName(code: string, el: t.JSXOpeningElement) {
  return el.name.type === 'JSXIdentifier' ? el.name.name : slice(code, el.name);
}

export function slice(code: string, node: t.Node) {
  return code.slice(node.start!, node.end!);
}

export function splice(code: string, node: t.Node, text: string) {
  return code.slice(0, node.start!) + text + code.slice(node.end!);
}

/**
 * Adds an attribute after the last one, matching the element's layout:
 * one-attribute-per-line elements get a new line at the same indent.
 */
export function insertAttributeEdit(code: string, el: t.JSXOpeningElement, text: string): TextEdit {
  const last = el.attributes.at(-1);
  const at = (last ?? el.name).end!;
  const multiline = last && last.loc!.start.line !== el.loc!.start.line;
  return { start: at, end: at, text: multiline ? `\n${indentAt(code, last.start!)}${text}` : ` ${text}` };
}

/** A text replacement on the original code. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits (any order) to the original code. */
export function applyTextEdits(code: string, edits: TextEdit[]) {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), code);
}

/** Where `offset` in the original code ends up after `edits`. */
export function shiftOffset(offset: number, edits: TextEdit[]) {
  return edits.reduce((o, e) => (e.end <= offset ? o + e.text.length - (e.end - e.start) : o), offset);
}

export function lineColOf(code: string, offset: number) {
  const before = code.slice(0, offset);
  const line = before.split('\n').length;
  return { line, col: offset - before.lastIndexOf('\n') };
}

/** Leading whitespace of the line containing `offset`. */
export function indentAt(code: string, offset: number) {
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))![0];
}

export const INDENT_UNIT = '  ';
