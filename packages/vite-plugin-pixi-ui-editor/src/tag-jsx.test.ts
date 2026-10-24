import { describe, expect, it } from 'vitest';
import { type IsOwnSource, tagJsx } from './tag-jsx';

const ROOT = '/repo';
const FILE = `${ROOT}/src/Foo.tsx`;

/** Relative imports and the `@acme/` workspace alias are the project's own; everything else is node_modules. */
const isOwn: IsOwnSource = async (source) => source.startsWith('.') || source.startsWith('@acme/');

async function tag(code: string, own = isOwn) {
  return (await tagJsx(code, FILE, ROOT, own))?.code ?? code;
}

describe('tagJsx', () => {
  it('tags pixi intrinsics and project / local components, after any spread', async () => {
    const out = await tag(`import { Button } from '@acme/ui';
import { Local2 } from './Local2';
const Local = () => null;
export const A = (p) => (
  <pixiContainer {...p}>
    <Button x={1} />
    <Local />
    <Local2 />
  </pixiContainer>
);`);
    expect(out).toContain('<pixiContainer {...p} __src="src/Foo.tsx:5:3">');
    expect(out).toContain('<Button x={1} __src="src/Foo.tsx:6:5" />');
    expect(out).toContain('<Local __src="src/Foo.tsx:7:5" />');
    expect(out).toContain('<Local2 __src="src/Foo.tsx:8:5" />');
  });

  it('leaves DOM tags, third-party components and React built-ins alone', async () => {
    const out = await tag(`import { Application } from '@pixi/react';
import { Fragment, Suspense } from 'react';
export const A = () => (
  <Suspense>
    <Fragment>
      <Application><div /></Application>
    </Fragment>
  </Suspense>
);`);
    expect(out).not.toContain('__src');
  });

  it('tags layout intrinsics and multi-line elements after their last attribute', async () => {
    const out = await tag(`export const A = () => (
  <layoutContainer
    x={1}
    y={2}
  >
    <pixiText text="hi" />
  </layoutContainer>
);`);
    expect(out).toContain('    y={2} __src="src/Foo.tsx:2:3"\n  >');
    expect(out).toContain('<pixiText text="hi" __src="src/Foo.tsx:6:5" />');
  });

  it('tags generic components after their type arguments', async () => {
    const out = await tag(`const List = <T,>(p: { items: T[] }) => null;
export const A = () => <List<number> items={[1]} />;`);
    expect(out).toContain('<List<number> items={[1]} __src="src/Foo.tsx:2:24" />');
    const bare = await tag(`const List = <T,>() => null;
export const A = () => <List<number> />;`);
    expect(bare).toContain('<List<number> __src="src/Foo.tsx:2:24" />');
  });

  it('never tags twice or type-only imports', async () => {
    const out = await tag(`import type { Props } from './props';
export const A = () => <pixiSprite __src="x:1:1" />;`);
    expect(out.match(/__src/g)).toHaveLength(1);
  });

  it('asks about each import source once and treats a failed resolve as third-party', async () => {
    const asked: string[] = [];
    const out = await tag(
      `import { A, B } from './ab';
import { C } from 'broken';
export const X = () => <><A /><B /><C /></>;`,
      async (source) => {
        asked.push(source);
        if (source === 'broken') throw new Error('cannot resolve');
        return true;
      },
    );
    expect(asked.sort()).toEqual(['./ab', 'broken']);
    expect(out).toContain('<A __src=');
    expect(out).toContain('<B __src=');
    expect(out).toContain('<C />');
  });

  it('returns nothing for files without JSX to tag, and a source map otherwise', async () => {
    expect(await tagJsx('export const a = 1;', FILE, ROOT, isOwn)).toBeUndefined();
    expect(await tagJsx('export const a = () => <div />;', FILE, ROOT, isOwn)).toBeUndefined();
    const result = await tagJsx('export const a = () => <pixiSprite />;', FILE, ROOT, isOwn);
    expect(result?.map.sources).toEqual([FILE]);
    expect(result?.map.mappings).not.toBe('');
  });
});
