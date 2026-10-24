import { describe, expect, it } from 'vitest';
import { applyEdit, applyEdits, describeElement, EditError } from './source-model';

const FILE = 'Popup.tsx';

// shaped like a typical popup component
const CODE = `import { Texture } from 'pixi.js';

const popupWidth = 820;
const popupY = 680;
const offset = -12;

export const Popup = ({ hidden }: { hidden: boolean }) => (
  <pixiContainer x={(1080 - popupWidth) / 2} y={popupY}>
    <pixiSprite
      texture={Texture.from('icon_error')}
      x={popupWidth / 2}
      anchor={0.5}
      y={offset}
    />
    <pixiText text="OK" eventMode="none" visible />
    <pixiGraphics />
  </pixiContainer>
);
`;

const CONTAINER = [8, 3] as const;
const SPRITE = [9, 5] as const;
const TEXT = [15, 5] as const;
const GRAPHICS = [16, 5] as const;

const describeAt = ([line, col]: readonly [number, number]) => describeElement(CODE, FILE, line, col);
const editAt = (
  [line, col]: readonly [number, number],
  prop: string,
  value: number | string | boolean,
  replace?: boolean,
) => applyEdit(CODE, FILE, line, col, { prop, value, replace });

/** The edited file differs from CODE only on these lines. */
function changedLines(next: string) {
  const a = CODE.split('\n');
  const b = next.split('\n');
  return b.map((line, i) => (line !== a[i] ? `${i + 1}: ${line}` : null)).filter(Boolean);
}

describe('describeElement', () => {
  it('classifies literal, const, texture and expression props', () => {
    const sprite = describeAt(SPRITE);
    expect(sprite.tag).toBe('pixiSprite');
    expect(sprite.props).toEqual([
      { name: 'texture', code: "{Texture.from('icon_error')}", edit: { value: 'icon_error', via: 'texture' } },
      { name: 'x', code: '{popupWidth / 2}', edit: undefined },
      { name: 'anchor', code: '{0.5}', edit: { value: 0.5, via: 'literal' } },
      { name: 'y', code: '{offset}', edit: { value: -12, via: 'const', constName: 'offset', constRefs: 1 } },
    ]);
  });

  it('counts const references so the UI can warn', () => {
    const y = describeAt(CONTAINER).props.find((p) => p.name === 'y');
    expect(y?.edit).toEqual({ value: 680, via: 'const', constName: 'popupY', constRefs: 1 });
  });

  it('handles JSX string attributes and boolean shorthand', () => {
    const props = describeAt(TEXT).props;
    expect(props.find((p) => p.name === 'eventMode')?.edit?.value).toBe('none');
    expect(props.find((p) => p.name === 'visible')).toEqual({
      name: 'visible',
      code: 'true',
      edit: { value: true, via: 'literal' },
    });
  });

  it('skips the injected __src attribute', () => {
    const tagged = CODE.replace('<pixiGraphics />', '<pixiGraphics __src="x:1:1" />');
    expect(describeElement(tagged, FILE, ...GRAPHICS).props).toEqual([]);
  });

  it('rejects a stale location', () => {
    expect(() => describeAt([9, 6])).toThrow(EditError);
  });
});

describe('applyEdit', () => {
  it('rewrites a literal in place', () => {
    expect(changedLines(editAt(SPRITE, 'anchor', 0.25))).toEqual(['12:       anchor={0.25}']);
  });

  it('rewrites the const declaration, not the usage', () => {
    expect(changedLines(editAt(CONTAINER, 'y', 700))).toEqual(['4: const popupY = 700;']);
  });

  it('handles negative numbers both ways', () => {
    expect(changedLines(editAt(SPRITE, 'y', 4))).toEqual(['5: const offset = 4;']);
    expect(changedLines(editAt(CONTAINER, 'y', -3))).toEqual(['4: const popupY = -3;']);
  });

  it('rewrites a texture key keeping the quote style', () => {
    expect(changedLines(editAt(SPRITE, 'texture', 'icon_ok'))).toEqual(["10:       texture={Texture.from('icon_ok')}"]);
  });

  it('rewrites JSX string attributes and boolean shorthand', () => {
    expect(changedLines(editAt(TEXT, 'eventMode', 'static'))).toEqual([
      '15:     <pixiText text="OK" eventMode="static" visible />',
    ]);
    expect(changedLines(editAt(TEXT, 'visible', false))).toEqual([
      '15:     <pixiText text="OK" eventMode="none" visible={false} />',
    ]);
  });

  it('inserts a missing attribute on its own line for multi-line elements', () => {
    const next = editAt(SPRITE, 'alpha', 0.5);
    expect(next.split('\n').slice(8, 15)).toEqual([
      '    <pixiSprite',
      "      texture={Texture.from('icon_error')}",
      '      x={popupWidth / 2}',
      '      anchor={0.5}',
      '      y={offset}',
      '      alpha={0.5}',
      '    />',
    ]);
  });

  it('inserts a missing attribute inline for single-line elements', () => {
    expect(changedLines(editAt(GRAPHICS, 'x', 10))).toEqual(['16:     <pixiGraphics x={10} />']);
    expect(changedLines(editAt(TEXT, 'alpha', 1))).toEqual([
      '15:     <pixiText text="OK" eventMode="none" visible alpha={1} />',
    ]);
  });

  it('rounds float noise', () => {
    expect(changedLines(editAt(SPRITE, 'anchor', 0.1 + 0.2))).toEqual(['12:       anchor={0.3}']);
  });

  it('replace: overwrites an expression with a literal', () => {
    expect(changedLines(editAt(SPRITE, 'x', 410, true))).toEqual(['11:       x={410}']);
  });

  it('replace: detaches a const usage without touching the declaration', () => {
    expect(changedLines(editAt(CONTAINER, 'y', 700, true))).toEqual([
      '8:   <pixiContainer x={(1080 - popupWidth) / 2} y={700}>',
    ]);
  });

  it('replace: on a missing attribute just inserts it', () => {
    expect(changedLines(editAt(GRAPHICS, 'y', 5, true))).toEqual(['16:     <pixiGraphics y={5} />']);
  });

  it('applies several edits in one pass (const above + insert inside)', () => {
    const next = applyEdits(CODE, FILE, ...CONTAINER, [
      { prop: 'y', value: 690 },
      { prop: 'x', value: 120, replace: true },
      { prop: 'alpha', value: 0.5 },
    ]);
    expect(changedLines(next)).toEqual([
      '4: const popupY = 690;',
      '8:   <pixiContainer x={120} y={popupY} alpha={0.5}>',
    ]);
  });

  it('refuses expressions and type changes', () => {
    expect(() => editAt(SPRITE, 'x', 1)).toThrow(/is an expression/);
    expect(() => editAt(SPRITE, 'anchor', 'big')).toThrow(EditError);
  });
});

// shaped like real-world components: orientation ternaries, object props, TextStyle consts
const GAME_UI = `import { TextStyle } from 'pixi.js';

const titleY = 650;
const titleStyle = new TextStyle({ fontSize: 40, fill: '#ffffff' });

export const Card = ({ isPortrait }: { isPortrait: boolean }) => (
  <pixiContainer
    y={isPortrait ? titleY : 360}
    x={!isPortrait ? 100 : width / 2}
    anchor={{ x: 0.5, y: 0 }}
    layout={{ width: 300, padding: { top: 8 } }}
  >
    <pixiText text="T" style={titleStyle} scale={display.isLandscape ? 0.6 : 0.7} />
  </pixiContainer>
);
`;
const CARD = [7, 3] as const;
const CARD_TEXT = [13, 5] as const;
const cardUiEdit = (at: readonly [number, number], edit: Parameters<typeof applyEdit>[4]) =>
  applyEdit(GAME_UI, FILE, at[0], at[1], edit);
const cardUiChanged = (next: string) => {
  const a = GAME_UI.split('\n');
  return next
    .split('\n')
    .map((l, i) => (l !== a[i] ? `${i + 1}: ${l}` : null))
    .filter(Boolean);
};

describe('orientation ternaries', () => {
  it('describes both sides, resolving consts and negation', () => {
    const props = describeElement(GAME_UI, FILE, ...CARD).props;
    expect(props.find((p) => p.name === 'y')?.branch).toEqual({
      test: 'isPortrait',
      portrait: { code: 'titleY', edit: { value: 650, via: 'const', constName: 'titleY', constRefs: 1 } },
      landscape: { code: '360', edit: { value: 360, via: 'literal' } },
    });
    // `!isPortrait ? 100 : …` → landscape is the consequent; the portrait side is an expression
    expect(props.find((p) => p.name === 'x')?.branch).toEqual({
      test: 'isPortrait',
      portrait: { code: 'width / 2' },
      landscape: { code: '100', edit: { value: 100, via: 'literal' } },
    });
  });

  it('edits only the requested side', () => {
    expect(cardUiChanged(cardUiEdit(CARD, { prop: 'y', value: 380, branch: 'landscape' }))).toEqual([
      '8:     y={isPortrait ? titleY : 380}',
    ]);
    expect(cardUiChanged(cardUiEdit(CARD, { prop: 'y', value: 600, branch: 'portrait' }))).toEqual([
      '3: const titleY = 600;',
    ]);
    expect(cardUiChanged(cardUiEdit(CARD_TEXT, { prop: 'scale', value: 0.5, branch: 'landscape' }))).toEqual([
      '13:     <pixiText text="T" style={titleStyle} scale={display.isLandscape ? 0.5 : 0.7} />',
    ]);
  });

  it('replace on one side overwrites just that side', () => {
    expect(cardUiChanged(cardUiEdit(CARD, { prop: 'x', value: 540, branch: 'portrait', replace: true }))).toEqual([
      '9:     x={!isPortrait ? 100 : 540}',
    ]);
  });
});

describe('object fields', () => {
  it('lists literal object fields, nested objects and TextStyle consts', () => {
    const card = describeElement(GAME_UI, FILE, ...CARD).props;
    expect(card.find((p) => p.name === 'anchor')?.fields).toEqual([
      { name: 'x', code: '0.5', edit: { value: 0.5, via: 'literal' } },
      { name: 'y', code: '0', edit: { value: 0, via: 'literal' } },
    ]);
    const layout = card.find((p) => p.name === 'layout')?.fields;
    expect(layout?.[1]).toEqual({
      name: 'padding',
      code: '{ top: 8 }',
      fields: [{ name: 'top', code: '8', edit: { value: 8, via: 'literal' } }],
      objectConst: undefined,
    });
    const style = describeElement(GAME_UI, FILE, ...CARD_TEXT).props.find((p) => p.name === 'style');
    expect(style?.objectConst).toEqual({ name: 'titleStyle', refs: 1 });
    expect(style?.fields?.map((f) => [f.name, f.edit?.value])).toEqual([
      ['fontSize', 40],
      ['fill', '#ffffff'],
    ]);
  });

  it('edits a field by dotted path, including inside a TextStyle const', () => {
    expect(cardUiChanged(cardUiEdit(CARD, { prop: 'anchor.y', value: 1 }))).toEqual([
      '10:     anchor={{ x: 0.5, y: 1 }}',
    ]);
    expect(cardUiChanged(cardUiEdit(CARD, { prop: 'layout.padding.top', value: 12 }))).toEqual([
      '11:     layout={{ width: 300, padding: { top: 12 } }}',
    ]);
    expect(cardUiChanged(cardUiEdit(CARD_TEXT, { prop: 'style.fill', value: '#ff0000' }))).toEqual([
      "4: const titleStyle = new TextStyle({ fontSize: 40, fill: '#ff0000' });",
    ]);
  });

  it('rejects unknown fields', () => {
    expect(() => cardUiEdit(CARD, { prop: 'anchor.z', value: 1 })).toThrow(/no field/);
  });
});

describe('movable', () => {
  it('is true only for direct JSX children', () => {
    expect(describeElement(GAME_UI, FILE, ...CARD).movable).toBe(false); // root of the arrow body
    expect(describeElement(GAME_UI, FILE, ...CARD_TEXT).movable).toBe(true);
  });
});

describe('orientation ternary behind a const', () => {
  const CODE2 = `export const P = ({ isPortrait }) => {
  const x = isPortrait ? 130 : (1920 - w) / 2;
  return (
    <pixiContainer>
      <pixiContainer x={x} />
    </pixiContainer>
  );
};
`;
  it('describes the sides and names the const', () => {
    const x = describeElement(CODE2, FILE, 5, 7).props.find((p) => p.name === 'x');
    expect(x?.branch).toEqual({
      test: 'isPortrait',
      viaConst: { name: 'x', refs: 1 },
      portrait: { code: '130', edit: { value: 130, via: 'literal' } },
      landscape: { code: '(1920 - w) / 2' },
    });
  });

  it('edits the side inside the const', () => {
    const next = applyEdit(CODE2, FILE, 5, 7, { prop: 'x', value: 140, branch: 'portrait' });
    expect(next.split('\n')[1]).toBe('  const x = isPortrait ? 140 : (1920 - w) / 2;');
    const replaced = applyEdit(CODE2, FILE, 5, 7, { prop: 'x', value: 600, branch: 'landscape', replace: true });
    expect(replaced.split('\n')[1]).toBe('  const x = isPortrait ? 130 : 600;');
  });
});

describe('offsets: the number term of a sum', () => {
  const LIST = `export const List = ({ items, width }: { items: string[]; width: number }) => (
  <pixiContainer>
    {items.map((item, i) => (
      <pixiText key={item} text={item} x={i * 100 + 40} y={40 + i * 100} />
    ))}
    <pixiSprite x={width - 20} y={width + -8} />
    <pixiText text={'#' + 1} />
  </pixiContainer>
);
`;
  const ITEM = [4, 7] as const;
  const SPRITE = [6, 5] as const;
  const LABEL = [7, 5] as const;
  const props = (at: readonly [number, number]) => describeElement(LIST, FILE, ...at).props;
  const edit = (at: readonly [number, number], prop: string, value: number) =>
    applyEdit(LIST, FILE, ...at, { prop, value });
  const line = (code: string, n: number) => code.split('\n')[n - 1].trim();

  it('describes the term and the expression it belongs to', () => {
    expect(props(ITEM).find((p) => p.name === 'x')?.edit).toEqual({ value: 40, via: 'offset', expr: 'i * 100 + 40' });
    expect(props(ITEM).find((p) => p.name === 'y')?.edit).toEqual({ value: 40, via: 'offset', expr: '40 + i * 100' });
    expect(props(SPRITE).find((p) => p.name === 'x')?.edit).toEqual({ value: -20, via: 'offset', expr: 'width - 20' });
    expect(props(SPRITE).find((p) => p.name === 'y')?.edit).toEqual({ value: -8, via: 'offset', expr: 'width + -8' });
  });

  it('shifts the term and keeps the rest of the expression', () => {
    expect(line(edit(ITEM, 'y', 48), 4)).toBe('<pixiText key={item} text={item} x={i * 100 + 40} y={48 + i * 100} />');
    expect(line(edit(ITEM, 'x', 75), 4)).toBe('<pixiText key={item} text={item} x={i * 100 + 75} y={40 + i * 100} />');
    expect(line(edit(ITEM, 'y', -5), 4)).toContain('y={-5 + i * 100}');
  });

  it('flips + and - when the term changes sign', () => {
    expect(line(edit(SPRITE, 'x', -32), 6)).toBe('<pixiSprite x={width - 32} y={width + -8} />');
    expect(line(edit(SPRITE, 'x', 12), 6)).toBe('<pixiSprite x={width + 12} y={width + -8} />');
    expect(line(edit(SPRITE, 'y', -3), 6)).toBe('<pixiSprite x={width - 20} y={width - 3} />');
  });

  it('leaves string concatenation alone', () => {
    expect(props(LABEL).find((p) => p.name === 'text')?.edit).toBeUndefined();
  });
});
