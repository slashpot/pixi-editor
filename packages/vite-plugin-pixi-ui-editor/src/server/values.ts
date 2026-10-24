import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { BranchSide, Orientation, PropInfo, PropValue, ValueEdit } from '../shared';
import { formatNumberOrBool, type TextEdit } from './ast';

/**
 * How expressions in a JSX attribute map onto something the editor can rewrite.
 * Everything here is read-only analysis; source-model.ts does the splicing.
 */

export interface Target extends ValueEdit {
  /** The node whose text gets replaced. */
  node: t.Node;
  /** How to write a new value, when that is more than replacing `node`'s text (offsets). */
  write?: (value: number) => TextEdit;
}

/** Nested object attributes deeper than this are shown as code only. */
const MAX_FIELD_DEPTH = 3;

/** `680`, `-12`, `0.5`, `'key'`, `true` — anything else is an expression. */
export function literalValue(node: t.Node): PropValue | undefined {
  switch (node.type) {
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'UnaryExpression':
      return node.operator === '-' && node.argument.type === 'NumericLiteral' ? -node.argument.value : undefined;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return literalValue(node.expression);
    default:
      return undefined;
  }
}

/** literal / same-file const holding a literal / `Texture.from('key')` / `Assets.get('key')` / `a + 40`. */
export function valueTarget(expr: NodePath<t.Expression>): Target | undefined {
  const literal = literalValue(expr.node);
  if (literal !== undefined) return { node: expr.node, value: literal, via: 'literal' };

  if (expr.isIdentifier()) {
    const decl = constDeclarator(expr);
    const init = decl?.init && literalValue(decl.init.node);
    if (!decl?.init || init === undefined) return undefined;
    return { node: decl.init.node, value: init, via: 'const', constName: expr.node.name, constRefs: decl.refs };
  }

  if (expr.isCallExpression()) {
    const { callee, arguments: args } = expr.node;
    const isTextureLookup =
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.property.type === 'Identifier' &&
      ((callee.object.name === 'Texture' && callee.property.name === 'from') ||
        (callee.object.name === 'Assets' && callee.property.name === 'get'));
    if (isTextureLookup && args.length === 1 && args[0].type === 'StringLiteral') {
      return { node: args[0], value: args[0].value, via: 'texture' };
    }
  }
  return offsetTarget(expr.node);
}

/**
 * The number term of a top-level sum: `40 + i * 100`, `i * 100 + 40`, `width - 20`.
 * `value` is what the term adds (-20 for `width - 20`); writing a new one keeps the rest
 * of the expression, flipping `+` / `-` when the sign changes. String concatenation is left alone.
 */
function offsetTarget(node: t.Node): Target | undefined {
  if (node.type !== 'BinaryExpression' || (node.operator !== '+' && node.operator !== '-')) return undefined;
  const { left, right, operator } = node;
  if (left.type === 'PrivateName' || isStringy(left) || isStringy(right)) return undefined;

  const r = literalValue(right);
  if (typeof r === 'number') {
    return {
      node,
      value: operator === '+' ? r : -r,
      via: 'offset',
      // ` + 8` / ` - 8`, replacing the operator and the literal
      write: (v) => ({
        start: left.end!,
        end: right.end!,
        text: ` ${v < 0 ? '-' : '+'} ${formatNumberOrBool(Math.abs(v))}`,
      }),
    };
  }
  const l = literalValue(left);
  if (typeof l === 'number') {
    return {
      node,
      value: l,
      via: 'offset',
      write: (v) => ({ start: left.start!, end: left.end!, text: formatNumberOrBool(v) }),
    };
  }
  return undefined;
}

function isStringy(node: t.Node) {
  return node.type === 'StringLiteral' || node.type === 'TemplateLiteral';
}

interface Branches {
  testCode: string;
  portrait: NodePath<t.Expression>;
  landscape: NodePath<t.Expression>;
  viaConst?: { name: string; refs: number };
}

/**
 * `isPortrait ? a : b`, `!isPortrait ? a : b`, `display.isLandscape ? a : b` …
 * The test only has to *name* the orientation; the editor never evaluates it.
 */
export function orientationBranches(expr: NodePath<t.Expression>): Branches | undefined {
  // `const x = isPortrait ? … : …` used as `x={x}`
  if (expr.isIdentifier()) {
    const decl = constDeclarator(expr);
    const found = decl?.init && orientationBranches(decl.init);
    return found && { ...found, viaConst: { name: expr.node.name, refs: decl.refs } };
  }
  if (!expr.isConditionalExpression()) return undefined;
  const test = orientationTest(expr.node.test);
  if (!test) return undefined;
  const consequent = expr.get('consequent');
  const alternate = expr.get('alternate');
  const portraitFirst = test.consequentIs === 'portrait';
  return {
    testCode: test.name,
    portrait: portraitFirst ? consequent : alternate,
    landscape: portraitFirst ? alternate : consequent,
  };
}

/** Which orientation makes `test` true: `isPortrait`, `!isLandscape`, `display.isPortrait` … */
function orientationTest(node: t.Expression) {
  let test = node;
  let flipped = false;
  while (test.type === 'UnaryExpression' && test.operator === '!') {
    test = test.argument;
    flipped = !flipped;
  }
  let name = '';
  if (test.type === 'Identifier') name = test.name;
  else if (test.type === 'MemberExpression' && test.property.type === 'Identifier') name = test.property.name;

  let named: Orientation | undefined;
  if (/portrait/i.test(name)) named = 'portrait';
  else if (/landscape/i.test(name)) named = 'landscape';
  if (!named) return undefined;
  const other: Orientation = named === 'portrait' ? 'landscape' : 'portrait';
  return { name, consequentIs: flipped ? other : named };
}

/**
 * The object literal behind an attribute value:
 * `{{ x: 0.5 }}`, a same-file const holding one, or `new TextStyle({ … })` (directly or via const).
 */
export function objectOf(expr: NodePath<t.Expression>) {
  let path: NodePath = expr;
  let constInfo: { name: string; refs: number } | undefined;
  if (expr.isIdentifier()) {
    const decl = constDeclarator(expr);
    if (!decl?.init) return undefined;
    path = decl.init;
    constInfo = { name: expr.node.name, refs: decl.refs };
  }
  if (path.isNewExpression()) {
    const arg = path.get('arguments')[0];
    if (!arg?.isObjectExpression()) return undefined;
    path = arg;
  }
  return path.isObjectExpression() ? { obj: path, constInfo } : undefined;
}

/** `{ x: 1, 'y': 2 }` → the value path of `key`. */
export function fieldOf(obj: NodePath<t.ObjectExpression>, key: string) {
  for (const prop of obj.get('properties')) {
    if (!prop.isObjectProperty() || prop.node.computed) continue;
    if (propKey(prop.node) !== key) continue;
    const value = prop.get('value');
    if (value.isExpression()) return value;
  }
  return undefined;
}

/** Everything the inspector shows for one value (attribute or object field). */
export function describeValue(code: string, expr: NodePath<t.Expression>, depth = 0): Omit<PropInfo, 'name' | 'code'> {
  const target = valueTarget(expr);
  if (target) return { edit: toEdit(target, code) };

  const branches = orientationBranches(expr);
  if (branches) {
    return {
      branch: {
        test: branches.testCode,
        ...(branches.viaConst && { viaConst: branches.viaConst }),
        portrait: side(code, branches.portrait),
        landscape: side(code, branches.landscape),
      },
    };
  }

  const object = depth < MAX_FIELD_DEPTH ? objectOf(expr) : undefined;
  if (object) {
    const fields: PropInfo[] = [];
    for (const prop of object.obj.get('properties')) {
      if (!prop.isObjectProperty() || prop.node.computed) continue;
      const key = propKey(prop.node);
      const value = prop.get('value');
      if (!key || !value.isExpression()) continue;
      fields.push({ name: key, code: slice(code, value.node), ...describeValue(code, value, depth + 1) });
    }
    return { fields, objectConst: object.constInfo };
  }
  return {};
}

export function toEdit(target: Target, code: string): ValueEdit {
  const { value, via, constName, constRefs } = target;
  if (via === 'offset') return { value, via, expr: slice(code, target.node) };
  return constName ? { value, via, constName, constRefs } : { value, via };
}

function side(code: string, expr: NodePath<t.Expression>): BranchSide {
  const target = valueTarget(expr);
  return target ? { code: slice(code, expr.node), edit: toEdit(target, code) } : { code: slice(code, expr.node) };
}

/** `const NAME = …` in scope (any depth), with how many places read it. */
function constDeclarator(id: NodePath<t.Identifier>) {
  const binding = id.scope.getBinding(id.node.name);
  if (binding?.kind !== 'const' || !binding.path.isVariableDeclarator()) return undefined;
  const init = binding.path.get('init');
  return { init: init.node ? (init as NodePath<t.Expression>) : undefined, refs: binding.referencePaths.length };
}

function propKey(prop: t.ObjectProperty) {
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return undefined;
}

export function slice(code: string, node: t.Node) {
  return code.slice(node.start!, node.end!);
}
