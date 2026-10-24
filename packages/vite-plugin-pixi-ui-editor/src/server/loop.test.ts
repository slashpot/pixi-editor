import { describe, expect, it } from 'vitest';
import { EditError } from './ast';
import { applyInstanceEdit } from './loop';
import { applyEdits, describeElement } from './source-model';

const FILE = 'List.tsx';

/** The opening tag `<tag` on the first line containing `marker`, as [line, col]. */
function at(code: string, marker: string, tag = '<pixiText'): [number, number] {
  const lines = code.split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  return [i + 1, lines[i].indexOf(tag) + 1];
}

const LIST = `const Item = (p: { x: number }) => null;
export const List = ({ items, rows }: { items: string[]; rows: string[][] }) => (
  <pixiContainer>
    {items.map((item, i) => (
      <pixiText key={item} text={item} x={40} y={40 + i * 100} />
    ))}
    {items.map((item) => {
      const label = item.toUpperCase();
      return <pixiText key={item} text={label} />;
    })}
    {items.map((item) => item && <pixiText key={item} text="cond" />)}
    {rows.map((row) => row.map((cell) => <pixiText key={cell} text="nested" />))}
    {items.filter(Boolean).map((item) => <Item key={item} x={10} />)}
  </pixiContainer>
);
`;

describe('loopOf (via describeElement)', () => {
  it('recognizes an element a .map callback returns directly', () => {
    expect(describeElement(LIST, FILE, ...at(LIST, 'y={40 + i * 100}')).inLoop).toBe(true);
    expect(describeElement(LIST, FILE, ...at(LIST, 'text={label}')).inLoop).toBe(true);
    expect(describeElement(LIST, FILE, ...at(LIST, '<Item', '<Item')).inLoop).toBe(true);
  });

  it('leaves out conditional elements, nested loops and elements outside loops', () => {
    expect(describeElement(LIST, FILE, ...at(LIST, 'text="cond"')).inLoop).toBe(false);
    expect(describeElement(LIST, FILE, ...at(LIST, 'text="nested"')).inLoop).toBe(false);
    expect(describeElement(LIST, FILE, ...at(LIST, '<pixiContainer>', '<pixiContainer')).inLoop).toBe(false);
  });
});

describe('applyInstanceEdit', () => {
  const ITEM = at(LIST, 'y={40 + i * 100}');
  const lineOf = (code: string, marker: string) =>
    code
      .split('\n')
      .find((l) => l.includes(marker))!
      .trim();

  it('wraps the shared value in a case for one index', () => {
    const { code } = applyInstanceEdit(LIST, FILE, ...ITEM, 'x', 75, 0);
    expect(lineOf(code, 'key={item} text={item}')).toBe(
      '<pixiText key={item} text={item} x={i === 0 ? 75 : 40} y={40 + i * 100} />',
    );
    const y = applyInstanceEdit(LIST, FILE, ...ITEM, 'y', 70, 1).code;
    expect(lineOf(y, 'key={item} text={item}')).toContain('y={i === 1 ? 70 : 40 + i * 100}');
  });

  it('edits the case an index already has, and adds cases for other indices', () => {
    const once = applyInstanceEdit(LIST, FILE, ...ITEM, 'x', 75, 0).code;
    const again = applyInstanceEdit(once, FILE, ...ITEM, 'x', 90, 0).code;
    expect(lineOf(again, 'key={item} text={item}')).toContain('x={i === 0 ? 90 : 40}');
    const other = applyInstanceEdit(again, FILE, ...ITEM, 'x', 5, 2).code;
    expect(lineOf(other, 'key={item} text={item}')).toContain('x={i === 2 ? 5 : i === 0 ? 90 : 40}');
  });

  it('inserts a missing position of a pixi object with 0 for the other items', () => {
    const MARK = 'text={label}';
    const { code } = applyInstanceEdit(LIST, FILE, ...at(LIST, MARK), 'x', 12, 1);
    expect(lineOf(code, MARK)).toBe('return <pixiText key={item} text={label} x={i === 1 ? 12 : 0} />;');
    expect(code).toContain('{items.map((item, i) => {');
  });

  it("refuses a component prop that isn't set, and elements outside a .map", () => {
    expect(() => applyInstanceEdit(LIST, FILE, ...at(LIST, '<Item', '<Item'), 'y', 1, 0)).toThrow(/add it first/);
    expect(() => applyInstanceEdit(LIST, FILE, ...at(LIST, 'text="nested"'), 'x', 1, 0)).toThrow(EditError);
  });

  it('adds an index parameter, picking a free name, and reports where the tag moved', () => {
    const bare = `export const A = ({ items }: { items: string[] }) => <>{items.map(item => <pixiText key={item} />)}</>;`;
    const done = applyInstanceEdit(bare, FILE, ...at(bare, 'items.map'), 'x', 3, 1);
    expect(done.code).toContain('items.map((item, i) => <pixiText key={item} x={i === 1 ? 3 : 0} />)');
    expect([done.line, done.col]).toEqual(at(done.code, 'items.map'));

    const taken = `const i = 1;
export const A = ({ items }: { items: string[] }) => <>{items.map(() => <pixiText x={i} />)}</>;`;
    expect(applyInstanceEdit(taken, FILE, ...at(taken, 'items.map'), 'x', 3, 0).code).toContain(
      'items.map((_item, index) => <pixiText x={index === 0 ? 3 : i} />)',
    );
  });

  it('applies x and y for one item in one request, declaring the index once', () => {
    const src = `export const A = ({ items }: { items: string[] }) => (
  <pixiContainer>
    {items.map((item) => <pixiText key={item} x={10} y={20} />)}
  </pixiContainer>
);
`;
    const done = applyEdits(src, FILE, ...at(src, 'items.map'), [
      { prop: 'x', value: 15, instance: 2 },
      { prop: 'y', value: 25, instance: 2 },
    ]);
    expect(done.code).toContain(
      'items.map((item, i) => <pixiText key={item} x={i === 2 ? 15 : 10} y={i === 2 ? 25 : 20} />)',
    );
    expect(describeElement(done.code, FILE, done.line, done.col).tag).toBe('pixiText');
  });
});
