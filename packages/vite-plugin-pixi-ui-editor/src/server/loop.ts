import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import { PIXI_INTRINSIC_RE } from '../shared';
import {
  applyTextEdits,
  EditError,
  findElement,
  formatNumberOrBool,
  insertAttributeEdit,
  lineColOf,
  shiftOffset,
  slice,
  tagName,
  type TextEdit,
} from './ast';
import type { Located } from './structure';

/**
 * Per-instance values for elements rendered by a `.map`. The JSX is written once, so
 * moving one item on screen has to become a case in the source:
 *
 *   {items.map((item, i) => <pixiText x={40} … />)}
 *   →  <pixiText x={i === 0 ? 75 : 40} … />
 */

type Callback = NodePath<t.ArrowFunctionExpression | t.FunctionExpression>;

/** Names tried for an index parameter the callback doesn't declare yet. */
const INDEX_NAMES = ['i', 'index', 'idx', 'itemIndex'];

/**
 * The `.map` callback that renders `el` once per item: `el` must be the whole arrow body or
 * the callback's top-level `return`, so the n-th instance on screen is item n. Elements in
 * nested loops are left out — the editor numbers instances across the whole list of lists.
 */
export function loopOf(el: NodePath<t.JSXOpeningElement>): Callback | undefined {
  const element = el.parentPath;
  const parent = element.parentPath;
  let fn: NodePath | undefined;
  if (parent?.isArrowFunctionExpression() && parent.node.body === element.node) {
    fn = parent;
  } else if (parent?.isReturnStatement()) {
    const block = parent.parentPath;
    const owner = block?.parentPath;
    if (block?.isBlockStatement() && owner?.isFunction() && owner.node.body === block.node) fn = owner;
  }
  if (!fn || !isMapCallback(fn)) return undefined;
  if (fn.parentPath?.findParent((p) => isMapCallback(p))) return undefined;
  return fn as Callback;
}

/** Sets `prop` for item `index` only, adding the index parameter if the callback has none. */
export function applyInstanceEdit(
  code: string,
  filename: string,
  line: number,
  col: number,
  prop: string,
  value: unknown,
  index: number,
): Located {
  if (typeof value !== 'number') throw new EditError(`\`${prop}\`: only numbers can be set per instance`);
  const el = findElement(code, filename, line, col);
  const fn = loopOf(el);
  if (!fn) {
    throw new EditError(
      'Only an element that a .map callback returns directly (outside other loops) can be changed for one instance',
    );
  }

  const param = indexParam(code, fn);
  const edits: TextEdit[] = [attributeEdit(code, el, prop, formatNumberOrBool(value), param.name, index)];
  if (param.edit) edits.push(param.edit);

  const next = applyTextEdits(code, edits);
  // only the parameter edit can come before the tag
  const start = shiftOffset(el.node.start!, param.edit ? [param.edit] : []);
  return { code: next, ...lineColOf(next, start) };
}

// ---------------------------------------------------------------------------

function isMapCallback(fn: NodePath): boolean {
  if (!fn.isArrowFunctionExpression() && !fn.isFunctionExpression()) return false;
  const call = fn.parentPath;
  if (!call?.isCallExpression() && !call?.isOptionalCallExpression()) return false;
  const { callee, arguments: args } = call.node as t.CallExpression;
  if (args[0] !== fn.node) return false;
  return (
    (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'map'
  );
}

/** The callback's index parameter, or a free name for one plus the edit that declares it. */
function indexParam(code: string, fn: Callback): { name: string; edit?: TextEdit } {
  const params = fn.node.params;
  if (params[1]) {
    if (params[1].type !== 'Identifier') throw new EditError("The .map callback's index parameter is not a plain name");
    return { name: params[1].name };
  }

  const name = INDEX_NAMES.find((n) => !fn.scope.hasBinding(n));
  if (!name) throw new EditError('No free name for an index parameter in this .map callback');
  const first = params[0];
  if (!first) {
    // `() => …` → `(_item, i) => …`
    const open = code.indexOf('(', fn.node.start!);
    return { name, edit: { start: open + 1, end: open + 1, text: `_item, ${name}` } };
  }
  // `item => …` has no parentheses to add to
  const parenthesized = code.slice(fn.node.start!, first.start!).includes('(');
  if (!parenthesized)
    return { name, edit: { start: first.start!, end: first.end!, text: `(${slice(code, first)}, ${name})` } };
  return { name, edit: { start: first.end!, end: first.end!, text: `, ${name}` } };
}

/** `x={E}` → `x={i === n ? v : E}`, or edits the `i === n` case already there. */
function attributeEdit(
  code: string,
  el: NodePath<t.JSXOpeningElement>,
  prop: string,
  value: string,
  indexName: string,
  index: number,
): TextEdit {
  const attr = el
    .get('attributes')
    .filter((a): a is NodePath<t.JSXAttribute> => a.isJSXAttribute() && a.node.name.name === prop)
    .at(-1);
  const test = `${indexName} === ${index}`;

  if (!attr) {
    const tag = tagName(code, el.node);
    // an unset position of a pixi object is 0; a component's default is unknown
    if (!PIXI_INTRINSIC_RE.test(tag)) throw new EditError(`<${tag}> doesn't set \`${prop}\`; add it first`);
    return insertAttributeEdit(code, el.node, `${prop}={${test} ? ${value} : 0}`);
  }
  const container = attr.node.value;
  if (container?.type !== 'JSXExpressionContainer' || container.expression.type === 'JSXEmptyExpression') {
    throw new EditError(`\`${prop}\` is not a number`);
  }

  const expr = container.expression;
  const existing = caseFor(expr, indexName, index);
  if (existing) return { start: existing.start!, end: existing.end!, text: value };
  const rest = LOOSE_TYPES.has(expr.type) ? `(${slice(code, expr)})` : slice(code, expr);
  return { start: expr.start!, end: expr.end!, text: `${test} ? ${value} : ${rest}` };
}

/** Expressions that bind looser than `?:`'s else branch and need parentheses there. */
const LOOSE_TYPES = new Set([
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'SequenceExpression',
  'YieldExpression',
]);

/** In `i === 0 ? a : i === 2 ? b : rest`, the value for `index`. */
function caseFor(expr: t.Expression, indexName: string, index: number): t.Expression | undefined {
  for (let e: t.Expression = expr; e.type === 'ConditionalExpression'; e = e.alternate) {
    const n = testedIndex(e.test, indexName);
    if (n === undefined) return undefined;
    if (n === index) return e.consequent;
  }
  return undefined;
}

/** `i === 2` / `2 === i` → 2. */
function testedIndex(test: t.Expression, indexName: string) {
  if (test.type !== 'BinaryExpression' || test.operator !== '===') return undefined;
  const { left, right } = test;
  if (left.type === 'Identifier' && left.name === indexName && right.type === 'NumericLiteral') return right.value;
  if (right.type === 'Identifier' && right.name === indexName && left.type === 'NumericLiteral') return left.value;
  return undefined;
}
