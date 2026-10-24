import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { Placement } from '../shared';
import {
  applyTextEdits,
  EditError,
  findElement,
  indentAt,
  INDENT_UNIT,
  lineColOf,
  parse,
  shiftOffset,
  slice,
  tagName,
  type TextEdit,
} from './ast';
import { traverse } from '../parse';
import { isMovable } from './source-model';

/**
 * Structural edits on JSX elements: insert / remove / move / duplicate.
 * Like attribute edits these are text splices; moved and copied elements are
 * re-indented to their new depth, everything else stays byte-for-byte.
 */

/** An import inserted JSX needs: `import { name } from 'from'`, added unless `name` is already bound. */
export interface ImportNeed {
  name: string;
  from: string;
}

export interface Located {
  code: string;
  line: number;
  col: number;
}

export function insertElement(
  code: string,
  filename: string,
  at: { line: number; col: number },
  placement: Placement,
  jsx: string,
  imports: ImportNeed[] = [],
): Located {
  // imports go in first; they shift the target down by the lines they add
  const withImports = imports.reduce((c, need) => ensureImport(c, filename, need), code);
  const line = at.line + lineCount(withImports) - lineCount(code);

  const target = jsxElement(withImports, filename, line, at.col);
  if (placement !== 'child') requireMovable(target, 'The target element');
  const insert = placementEdit(withImports, target, placement, jsx);
  return locate(applyTextEdits(withImports, [insert.edit]), insert, []);
}

export function removeElement(code: string, filename: string, line: number, col: number) {
  const el = jsxElement(code, filename, line, col);
  requireMovable(el, 'This element');
  const names = identifiersIn(el);
  const next = applyTextEdits(code, [removalEdit(code, el.node)]);
  return removeUnusedImports(next, filename, names);
}

export function duplicateElement(code: string, filename: string, line: number, col: number): Located {
  const el = jsxElement(code, filename, line, col);
  requireMovable(el, 'This element');
  const insert = placementEdit(code, el, 'after', dedentedText(code, el.node));
  return locate(applyTextEdits(code, [insert.edit]), insert, []);
}

export function moveElement(
  code: string,
  filename: string,
  from: { line: number; col: number },
  to: { line: number; col: number },
  placement: Placement,
): Located {
  const el = jsxElement(code, filename, from.line, from.col);
  const target = jsxElement(code, filename, to.line, to.col);
  requireMovable(el, 'The dragged element');
  if (placement !== 'child') requireMovable(target, 'The target element');
  if (target.node.start! >= el.node.start! && target.node.end! <= el.node.end!) {
    throw new EditError('Cannot move an element into itself');
  }

  const removal = removalEdit(code, el.node);
  const insert = placementEdit(code, target, placement, dedentedText(code, el.node));
  // the insertion point must not fall inside the text being removed
  if (insert.edit.start > removal.start && insert.edit.start < removal.end)
    throw new EditError('Invalid target position');
  return locate(applyTextEdits(code, [removal, insert.edit]), insert, [removal]);
}

// ---------------------------------------------------------------------------

function jsxElement(code: string, filename: string, line: number, col: number) {
  const opening = findElement(code, filename, line, col);
  return opening.parentPath as NodePath<t.JSXElement>;
}

function requireMovable(el: NodePath<t.JSXElement>, label: string) {
  if (!isMovable(el.get('openingElement'))) {
    throw new EditError(
      `${label} is not a direct child of another JSX element (e.g. it sits in a conditional, a loop, or at the top of a return), so it cannot be moved`,
    );
  }
}

interface Insertion {
  edit: TextEdit;
  /** Index in `edit.text` where the element's `<` lands. */
  at: number;
}

/** The new element's line:col after all edits. */
function locate(next: string, insert: Insertion, others: TextEdit[]): Located {
  const offset = shiftOffset(insert.edit.start, others) + insert.at;
  return { code: next, ...lineColOf(next, offset) };
}

function placementEdit(code: string, target: NodePath<t.JSXElement>, placement: Placement, text: string): Insertion {
  const node = target.node;
  const indent = indentAt(code, node.start!);

  if (placement === 'after') {
    return {
      edit: { start: node.end!, end: node.end!, text: `\n${indent}${reindent(text, indent)}` },
      at: 1 + indent.length,
    };
  }
  if (placement === 'before') {
    const lineStart = code.lastIndexOf('\n', node.start! - 1) + 1;
    if (code.slice(lineStart, node.start!).trim() === '') {
      return {
        edit: { start: lineStart, end: lineStart, text: `${indent}${reindent(text, indent)}\n` },
        at: indent.length,
      };
    }
    return { edit: { start: node.start!, end: node.start!, text: `${reindent(text, indent)}\n${indent}` }, at: 0 };
  }

  const child = indent + INDENT_UNIT;
  const body = `${child}${reindent(text, child)}`;
  const closing = node.closingElement;
  if (!closing) {
    // <X … />  →  <X …>\n  child\n</X>
    const opening = node.openingElement;
    const selfClose = code.lastIndexOf('/>', opening.end!);
    const start = code.slice(0, selfClose).trimEnd().length;
    const close = `</${tagName(code, opening)}>`;
    return { edit: { start, end: opening.end!, text: `>\n${body}\n${indent}${close}` }, at: 2 + child.length };
  }
  const lineStart = code.lastIndexOf('\n', closing.start! - 1) + 1;
  if (code.slice(lineStart, closing.start!).trim() === '') {
    return { edit: { start: lineStart, end: lineStart, text: `${body}\n` }, at: child.length };
  }
  return { edit: { start: closing.start!, end: closing.start!, text: `\n${body}\n${indent}` }, at: 1 + child.length };
}

/** Removes the element, and its whole line when it sits alone on it. */
function removalEdit(code: string, node: t.Node): TextEdit {
  const lineStart = code.lastIndexOf('\n', node.start! - 1) + 1;
  const newline = code.indexOf('\n', node.end!);
  const lineEnd = newline === -1 ? code.length : newline;
  const aloneOnLine = code.slice(lineStart, node.start!).trim() === '' && code.slice(node.end!, lineEnd).trim() === '';
  if (aloneOnLine) return { start: lineStart, end: Math.min(lineEnd + 1, code.length), text: '' };
  return { start: node.start!, end: node.end!, text: '' };
}

/** Element text with its continuation lines made relative to its first line. */
function dedentedText(code: string, node: t.Node) {
  const base = indentAt(code, node.start!);
  return slice(code, node)
    .split('\n')
    .map((line, i) => (i > 0 && line.startsWith(base) ? line.slice(base.length) : line))
    .join('\n');
}

function reindent(text: string, indent: string) {
  return text
    .split('\n')
    .map((line, i) => (i === 0 || line.trim() === '' ? line : indent + line))
    .join('\n');
}

function lineCount(code: string) {
  return code.split('\n').length;
}

// --- imports ---------------------------------------------------------------

/** Adds `import { name } from 'from'` unless `name` is already bound in the module. */
export function ensureImport(code: string, filename: string, { name, from }: ImportNeed) {
  const ast = parse(code, filename);
  let program: NodePath<t.Program> | undefined;
  traverse(ast, {
    Program(path) {
      program = path;
      path.stop();
    },
  });
  if (!program || program.scope.hasBinding(name)) return code;

  const imports = program.get('body').filter((s): s is NodePath<t.ImportDeclaration> => s.isImportDeclaration());
  const same = imports.find(
    (d) =>
      d.node.source.value === from &&
      d.node.importKind !== 'type' &&
      d.node.specifiers.some((s) => s.type === 'ImportSpecifier'),
  );
  if (same) {
    const last = same.node.specifiers.at(-1)!;
    return applyTextEdits(code, [{ start: last.end!, end: last.end!, text: `, ${name}` }]);
  }
  const after = imports.at(-1)?.node.end ?? 0;
  const text = `${after ? '\n' : ''}import { ${name} } from '${from}';${after ? '' : '\n'}`;
  return applyTextEdits(code, [{ start: after, end: after, text }]);
}

function identifiersIn(el: NodePath<t.JSXElement>) {
  const names = new Set<string>();
  el.traverse({
    Identifier(p) {
      names.add(p.node.name);
    },
    JSXIdentifier(p) {
      names.add(p.node.name);
    },
  });
  return names;
}

/** Drops named imports among `names` that nothing references any more. */
export function removeUnusedImports(code: string, filename: string, names: Set<string>) {
  const ast = parse(code, filename);
  const unused = new Map<t.ImportDeclaration, Set<t.Node>>();
  traverse(ast, {
    Program(program) {
      for (const name of names) {
        const binding = program.scope.getBinding(name);
        const decl = binding?.path.parentPath;
        if (binding?.kind !== 'module' || binding.referencePaths.length > 0 || !decl?.isImportDeclaration()) continue;
        unused.set(decl.node, (unused.get(decl.node) ?? new Set()).add(binding.path.node));
      }
      program.stop();
    },
  });

  const edits: TextEdit[] = [];
  for (const [decl, gone] of unused) {
    const kept = decl.specifiers.filter((s) => !gone.has(s));
    if (kept.length === 0) {
      edits.push(removalEdit(code, decl));
      continue;
    }
    // rewrite just the named list; a default import before `{` is left alone
    const named = decl.specifiers.filter((s) => s.type === 'ImportSpecifier');
    const keptNamed = kept.filter((s) => s.type === 'ImportSpecifier');
    if (named.length === 0) continue;
    edits.push({
      start: named[0].start!,
      end: named.at(-1)!.end!,
      text: keptNamed.map((s) => slice(code, s)).join(', '),
    });
  }
  return applyTextEdits(code, edits);
}
