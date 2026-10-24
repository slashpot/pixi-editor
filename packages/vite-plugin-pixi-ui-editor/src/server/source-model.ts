import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import { type PropEdit, type PropInfo, type PropValue, SRC_ATTR } from '../shared';
import {
  applyTextEdits,
  EditError,
  findElement,
  formatNumberOrBool,
  insertAttributeEdit,
  slice,
  splice,
  tagName,
} from './ast';
import { applyInstanceEdit, loopOf } from './loop';
import type { Located } from './structure';
import { describeValue, fieldOf, objectOf, orientationBranches, valueTarget } from './values';

export { EditError, hashOf } from './ast';

/**
 * Reads and rewrites the attributes of one JSX element of a .tsx file.
 *
 * Edits are text splices at AST node offsets, so every byte outside the edited
 * value (formatting, comments, the rest of the file) is left exactly as it was.
 */

export function describeElement(code: string, filename: string, line: number, col: number) {
  const el = findElement(code, filename, line, col);
  const props: PropInfo[] = [];

  for (const attr of el.get('attributes')) {
    if (attr.isJSXSpreadAttribute()) {
      props.push({ name: '...', code: slice(code, attr.node) });
      continue;
    }
    if (!attr.isJSXAttribute()) continue;
    const name = attrName(attr.node);
    if (name === SRC_ATTR) continue;

    const value = attr.node.value;
    if (!value) {
      props.push({ name, code: 'true', edit: { value: true, via: 'literal' } });
    } else if (value.type === 'StringLiteral') {
      props.push({ name, code: slice(code, value), edit: { value: value.value, via: 'literal' } });
    } else {
      const expr = attrExpression(attr as NodePath<t.JSXAttribute>);
      props.push({ name, code: slice(code, value), ...(expr ? describeValue(code, expr) : {}) });
    }
  }
  return { tag: tagName(code, el.node), props, movable: isMovable(el), inLoop: !!loopOf(el) };
}

/** Whether the element is a direct child of another JSX element / fragment. */
export function isMovable(el: NodePath<t.JSXOpeningElement>) {
  const parent = el.parentPath.parentPath;
  return !!parent && (parent.isJSXElement() || parent.isJSXFragment());
}

/**
 * Applies edits one after another and reports where the element ended up. Attribute edits
 * never move the opening tag (they touch attributes after it, or a const declared on an
 * earlier line whose value never spans a newline); a per-instance edit may add an index
 * parameter before it, and says where the tag went.
 */
export function applyEdits(code: string, filename: string, line: number, col: number, edits: PropEdit[]): Located {
  return edits.reduce<Located>(
    (at, edit) =>
      edit.instance === undefined
        ? { ...at, code: applyEdit(at.code, filename, at.line, at.col, edit) }
        : applyInstanceEdit(at.code, filename, at.line, at.col, edit.prop, edit.value, edit.instance),
    { code, line, col },
  );
}

export function applyEdit(code: string, filename: string, line: number, col: number, edit: PropEdit): string {
  const { value, branch, replace } = edit;
  const [prop, ...path] = edit.prop.split('.');
  const el = findElement(code, filename, line, col);
  const attr = el
    .get('attributes')
    .filter((a): a is NodePath<t.JSXAttribute> => a.isJSXAttribute() && attrName(a.node) === prop)
    .at(-1);

  if (!attr) {
    if (path.length || branch) throw new EditError(`\`${edit.prop}\`: the element has no \`${prop}\` attribute`);
    return applyTextEdits(code, [insertAttributeEdit(code, el.node, `${prop}=${attrValue(value)}`)]);
  }

  // attribute forms that have no expression to resolve
  if (!path.length && !branch) {
    const v = attr.node.value;
    if (!v || replace) return splice(code, v ?? attr.node, v ? attrValue(value) : `${prop}=${attrValue(value)}`);
    if (v.type === 'StringLiteral') {
      checkType(edit.prop, v.value, value);
      return splice(code, v, attrValue(value));
    }
  }

  const expr = resolvePath(attr, path, edit.prop, branch);
  if (replace) return splice(code, expr.node, jsValue(value, expr.node));
  const target = valueTarget(expr);
  if (!target) throw new EditError(`\`${edit.prop}\` is an expression and cannot be rewritten in place`);
  checkType(edit.prop, target.value, value);
  if (target.write) return applyTextEdits(code, [target.write(value as number)]);
  return splice(code, target.node, jsValue(value, target.node));
}

// ---------------------------------------------------------------------------

/** attribute → object fields (`anchor.x`) → orientation side, as far as the edit asks. */
function resolvePath(attr: NodePath<t.JSXAttribute>, path: string[], label: string, branch: PropEdit['branch']) {
  let expr = attrExpression(attr);
  if (!expr) throw new EditError(`\`${label}\` has no editable value`);
  for (const key of path) {
    const object = objectOf(expr);
    const field = object && fieldOf(object.obj, key);
    if (!field) throw new EditError(`\`${label}\`: no field \`${key}\``);
    expr = field;
  }
  if (!branch) return expr;
  const sides = orientationBranches(expr);
  if (!sides) throw new EditError(`\`${label}\` is not a portrait / landscape conditional`);
  return sides[branch];
}

function attrExpression(attr: NodePath<t.JSXAttribute>) {
  const value = attr.get('value');
  if (!value.isJSXExpressionContainer()) return undefined;
  const expr = value.get('expression');
  return expr.isExpression() ? expr : undefined;
}

function checkType(prop: string, current: PropValue, next: PropValue) {
  if (typeof current !== typeof next) throw new EditError(`\`${prop}\` is a ${typeof current}, got a ${typeof next}`);
}

function attrValue(value: PropValue) {
  if (typeof value !== 'string') return `{${formatNumberOrBool(value)}}`;
  if (value.includes('"')) throw new EditError('A JSX attribute string cannot contain "');
  return `"${value}"`;
}

/** Keeps the original quote style of the string being replaced. */
function jsValue(value: PropValue, replaced: t.Node) {
  if (typeof value !== 'string') return formatNumberOrBool(value);
  const raw = (replaced as t.StringLiteral).extra?.raw as string | undefined;
  const quote = raw?.[0] === '"' ? '"' : "'";
  const escaped = value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

function attrName(attr: t.JSXAttribute) {
  return attr.name.type === 'JSXIdentifier' ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
}
