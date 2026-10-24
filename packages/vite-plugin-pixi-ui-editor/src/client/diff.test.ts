import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe('diffLines', () => {
  it('finds no hunks in equal text', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([]);
  });

  it('shows a changed line with its context, removal first', () => {
    const before = lines(10);
    const after = [...before];
    after[4] = 'changed';
    const [hunk, ...rest] = diffLines(before.join('\n'), after.join('\n'), 2);
    expect(rest).toEqual([]);
    expect(hunk).toEqual({
      oldStart: 3,
      newStart: 3,
      lines: [
        { kind: ' ', text: 'line 3' },
        { kind: ' ', text: 'line 4' },
        { kind: '-', text: 'line 5' },
        { kind: '+', text: 'changed' },
        { kind: ' ', text: 'line 6' },
        { kind: ' ', text: 'line 7' },
      ],
    });
  });

  it('numbers an insertion and splits distant changes into hunks', () => {
    const before = lines(20);
    const after = [...before];
    after.splice(15, 1);
    after.splice(2, 0, 'inserted');
    const hunks = diffLines(before.join('\n'), after.join('\n'), 1);
    expect(hunks.map((h) => [h.oldStart, h.newStart, h.lines.map((l) => l.kind + l.text)])).toEqual([
      [2, 2, [' line 2', '+inserted', ' line 3']],
      [15, 16, [' line 15', '-line 16', ' line 17']],
    ]);
  });

  it('merges changes closer than two contexts', () => {
    const before = lines(10);
    const after = [...before];
    after[2] = 'x';
    after[5] = 'y';
    expect(diffLines(before.join('\n'), after.join('\n'), 2)).toHaveLength(1);
  });
});
