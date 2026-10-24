import { describe, expect, it } from 'vitest';
import { duplicateElement, ensureImport, insertElement, moveElement, removeElement } from './structure';

const FILE = 'Panel.tsx';

const CODE = `import { Texture } from 'pixi.js';
import { Button } from '@acme/ui';

export const Panel = () => (
  <pixiContainer y={10}>
    <pixiSprite texture={Texture.from('bg')} />
    <pixiContainer
      x={20}
    >
      <pixiText text="A" />
    </pixiContainer>
    <Button x={1} />
    <pixiGraphics />
  </pixiContainer>
);
`;

const ROOT = { line: 5, col: 3 };
const SPRITE = { line: 6, col: 5 };
const INNER = { line: 7, col: 5 };
const TEXT = { line: 10, col: 7 };
const BUTTON = { line: 12, col: 5 };
const GRAPHICS = { line: 13, col: 5 };

const body = (code: string) => code.split('\n').slice(4, -2).join('\n');

describe('insertElement', () => {
  it('appends a child before the closing tag', () => {
    const done = insertElement(CODE, FILE, INNER, 'child', '<pixiSprite x={1} />');
    expect(body(done.code)).toBe(`  <pixiContainer y={10}>
    <pixiSprite texture={Texture.from('bg')} />
    <pixiContainer
      x={20}
    >
      <pixiText text="A" />
      <pixiSprite x={1} />
    </pixiContainer>
    <Button x={1} />
    <pixiGraphics />
  </pixiContainer>`);
    expect(done).toMatchObject({ line: 11, col: 7 });
  });

  it('opens up a self-closing element to take a child', () => {
    const done = insertElement(CODE, FILE, GRAPHICS, 'child', '<pixiText text="B" />');
    expect(done.code.split('\n').slice(12, 15)).toEqual([
      '    <pixiGraphics>',
      '      <pixiText text="B" />',
      '    </pixiGraphics>',
    ]);
    expect(done).toMatchObject({ line: 14, col: 7 });
  });

  it('inserts a multi-line template after a sibling, re-indented', () => {
    const done = insertElement(CODE, FILE, SPRITE, 'after', '<pixiGraphics\n  x={0}\n/>');
    expect(done.code.split('\n').slice(5, 9)).toEqual([
      "    <pixiSprite texture={Texture.from('bg')} />",
      '    <pixiGraphics',
      '      x={0}',
      '    />',
    ]);
    expect(done).toMatchObject({ line: 7, col: 5 });
  });

  it('adds imports first and still finds the target', () => {
    const done = insertElement(CODE, FILE, SPRITE, 'before', '<FixedContainer />', [
      { name: 'FixedContainer', from: '@acme/ui' },
    ]);
    expect(done.code.split('\n')[1]).toBe("import { Button, FixedContainer } from '@acme/ui';");
    expect(done.code.split('\n')[5]).toBe('    <FixedContainer />');
    expect(done).toMatchObject({ line: 6, col: 5 });
  });

  it('refuses before/after on the root element', () => {
    expect(() => insertElement(CODE, FILE, ROOT, 'after', '<pixiText />')).toThrow(/cannot be moved/);
  });
});

describe('ensureImport', () => {
  it('adds a new import line after the last import', () => {
    expect(ensureImport(CODE, FILE, { name: 'Assets', from: 'pixi.js' }).split('\n')[0]).toBe(
      "import { Texture, Assets } from 'pixi.js';",
    );
    expect(ensureImport(CODE, FILE, { name: 'gsap', from: 'gsap' }).split('\n')[2]).toBe(
      "import { gsap } from 'gsap';",
    );
  });

  it('is a no-op when the name is already bound', () => {
    expect(ensureImport(CODE, FILE, { name: 'Texture', from: 'pixi.js' })).toBe(CODE);
  });
});

describe('removeElement', () => {
  it('removes the whole line and now-unused imports', () => {
    const next = removeElement(CODE, FILE, SPRITE.line, SPRITE.col);
    expect(next.split('\n')[0]).toBe("import { Button } from '@acme/ui';");
    expect(next).not.toContain('Texture');
    expect(next.split('\n')).toHaveLength(CODE.split('\n').length - 2);
  });

  it('removes a multi-line element', () => {
    const next = removeElement(CODE, FILE, INNER.line, INNER.col);
    expect(body(next)).toBe(`  <pixiContainer y={10}>
    <pixiSprite texture={Texture.from('bg')} />
    <Button x={1} />
    <pixiGraphics />
  </pixiContainer>`);
  });

  it('keeps imports still used elsewhere', () => {
    const twice = CODE.replace('<pixiGraphics />', "<pixiSprite texture={Texture.from('x')} />");
    expect(removeElement(twice, FILE, SPRITE.line, SPRITE.col)).toContain("import { Texture } from 'pixi.js';");
  });
});

describe('moveElement', () => {
  it('moves down past siblings', () => {
    const done = moveElement(CODE, FILE, SPRITE, GRAPHICS, 'after');
    expect(body(done.code).split('\n').slice(-3)).toEqual([
      '    <pixiGraphics />',
      "    <pixiSprite texture={Texture.from('bg')} />",
      '  </pixiContainer>',
    ]);
    expect(done).toMatchObject({ line: 13, col: 5 });
  });

  it('moves up and into another element, re-indenting', () => {
    const done = moveElement(CODE, FILE, BUTTON, INNER, 'child');
    expect(body(done.code)).toBe(`  <pixiContainer y={10}>
    <pixiSprite texture={Texture.from('bg')} />
    <pixiContainer
      x={20}
    >
      <pixiText text="A" />
      <Button x={1} />
    </pixiContainer>
    <pixiGraphics />
  </pixiContainer>`);
    expect(done).toMatchObject({ line: 11, col: 7 });
  });

  it('moves a multi-line element out of its parent', () => {
    const done = moveElement(CODE, FILE, TEXT, SPRITE, 'before');
    expect(body(done.code).split('\n').slice(0, 3)).toEqual([
      '  <pixiContainer y={10}>',
      '    <pixiText text="A" />',
      "    <pixiSprite texture={Texture.from('bg')} />",
    ]);
    expect(done).toMatchObject({ line: 6, col: 5 });
  });

  it('refuses moving an element into itself', () => {
    expect(() => moveElement(CODE, FILE, INNER, TEXT, 'after')).toThrow(/into itself/);
  });
});

describe('duplicateElement', () => {
  it('copies the element right after itself', () => {
    const done = duplicateElement(CODE, FILE, INNER.line, INNER.col);
    expect(body(done.code).split('\n').slice(2, 10)).toEqual([
      '    <pixiContainer',
      '      x={20}',
      '    >',
      '      <pixiText text="A" />',
      '    </pixiContainer>',
      '    <pixiContainer',
      '      x={20}',
      '    >',
    ]);
    expect(done).toMatchObject({ line: 12, col: 5 });
  });
});
