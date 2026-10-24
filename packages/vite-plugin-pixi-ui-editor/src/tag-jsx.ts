import { relative, sep } from 'node:path';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import MagicString from 'magic-string';
import { parseModule, traverse } from './parse';
import { PIXI_INTRINSIC_RE, SRC_ATTR } from './shared';

/** Whether an import source (`./Button`, `@acme/ui`) resolves to code in the user's project, not node_modules. */
export type IsOwnSource = (source: string) => Promise<boolean>;

/**
 * Tags JSX elements with their source location:
 *   <pixiSprite x={1} />  →  <pixiSprite x={1} __src="src/Foo.tsx:12:7" />
 *   <Button x={1} />      →  <Button x={1} __src="src/Foo.tsx:20:9" />
 *
 * Pixi intrinsics get it as an instance property (via @pixi/react's applyProps).
 * Components keep it in their React props, where the client finds it through the
 * fiber tree — so a click inside <Button> can select the call site.
 * Only components defined in this file or imported from the project (not node_modules)
 * are tagged, so an extra prop can't reach code we don't control.
 *
 * Runs as a `pre` transform on the original source, before @vitejs/plugin-react
 * (and React Compiler) see it. Returns undefined when nothing was tagged.
 */
export async function tagJsx(code: string, filename: string, root: string, isOwnSource: IsOwnSource) {
  if (!code.includes('<')) return undefined;
  const ast = parseModule(code);
  const file = relative(root, filename).split(sep).join('/');

  const candidates: { el: t.JSXOpeningElement; importedFrom?: string }[] = [];
  traverse(ast, {
    JSXOpeningElement(path) {
      const { name, loc, attributes } = path.node;
      if (!loc || name.type !== 'JSXIdentifier' || attributes.some(isSrcAttr)) return;
      const kind = tagKind(path, name.name);
      if (kind === 'intrinsic' || kind === 'local') candidates.push({ el: path.node });
      else if (kind) candidates.push({ el: path.node, importedFrom: kind.from });
    },
  });

  const own = new Map<string, Promise<boolean>>();
  const ownSource = (source: string) => {
    if (!own.has(source))
      own.set(
        source,
        isOwnSource(source).catch(() => false),
      );
    return own.get(source)!;
  };
  const tagged = await Promise.all(
    candidates.map(async (c) => (!c.importedFrom || (await ownSource(c.importedFrom)) ? c.el : undefined)),
  );

  const s = new MagicString(code);
  for (const el of tagged) {
    if (!el) continue;
    const { line, column } = el.loc!.start;
    // last, so a `{...props}` spread can't override it
    const after = el.attributes.at(-1) ?? el.typeArguments ?? el.typeParameters ?? el.name;
    s.appendLeft(after.end!, ` ${SRC_ATTR}="${file}:${line}:${column + 1}"`);
  }
  if (!s.hasChanged()) return undefined;
  return { code: s.toString(), map: s.generateMap({ hires: 'boundary', source: filename, includeContent: true }) };
}

type TagKind = 'intrinsic' | 'local' | { from: string } | undefined;

function tagKind(path: NodePath<t.JSXOpeningElement>, name: string): TagKind {
  if (PIXI_INTRINSIC_RE.test(name)) return 'intrinsic';
  if (!/^[A-Z]/.test(name)) return undefined;

  const binding = path.scope.getBinding(name);
  if (!binding) return undefined;
  if (binding.kind !== 'module') return 'local'; // defined in this file
  const decl = binding.path.parentPath;
  if (!decl?.isImportDeclaration() || decl.node.importKind === 'type') return undefined;
  return { from: decl.node.source.value };
}

function isSrcAttr(attr: t.JSXAttribute | t.JSXSpreadAttribute) {
  return attr.type === 'JSXAttribute' && attr.name.name === SRC_ATTR;
}
