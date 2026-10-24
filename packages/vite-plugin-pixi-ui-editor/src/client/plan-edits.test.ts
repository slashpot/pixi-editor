import { describe, expect, it } from 'vitest';
import type { ElementInfo, PropInfo } from '../shared';
import { planEdits, sourceNumber } from './plan-edits';

const info = (...props: PropInfo[]): ElementInfo => ({
  src: 'a.tsx:1:1',
  tag: 'pixiSprite',
  hash: 'h',
  props,
  movable: true,
  inLoop: false,
});
const literal = (name: string, value: number): PropInfo => ({
  name,
  code: `{${value}}`,
  edit: { value, via: 'literal' },
});
const constant = (name: string, value: number, constRefs: number): PropInfo => ({
  name,
  code: '{popupY}',
  edit: { value, via: 'const', constName: 'popupY', constRefs },
});
const expression = (name: string, code: string): PropInfo => ({ name, code });

const never = () => {
  throw new Error('should not ask');
};

describe('planEdits', () => {
  it('writes literals, missing props and single-use consts without asking', () => {
    const plan = planEdits(
      info(literal('x', 1), constant('y', 2, 1)),
      [
        { prop: 'x', value: 10 },
        { prop: 'y', value: 20 },
        { prop: 'alpha', value: 0.5 },
      ],
      1,
      never,
    );
    expect(plan).toEqual({
      edits: [
        { prop: 'x', value: 10 },
        { prop: 'y', value: 20 },
        { prop: 'alpha', value: 0.5 },
      ],
      reverted: [],
    });
  });

  it('asks before moving a shared const; "no" detaches into a literal', () => {
    const questions: string[] = [];
    const plan = planEdits(info(constant('y', 2, 3)), [{ prop: 'y', value: 20 }], 1, (q) => {
      questions.push(q);
      return false;
    });
    expect(questions[0]).toContain('shared by 3');
    expect(plan.edits).toEqual([{ prop: 'y', value: 20, replace: true }]);
  });

  it('asks before overwriting an expression; "no" reverts', () => {
    const plan = planEdits(info(expression('x', '{w / 2}')), [{ prop: 'x', value: 5 }], 1, () => false);
    expect(plan).toEqual({ edits: [], reverted: ['x'] });
  });

  it('warns about loop instances when overwriting an expression', () => {
    let question = '';
    const plan = planEdits(info(expression('x', '{index * 100}')), [{ prop: 'x', value: 5 }], 3, (q) => {
      question = q;
      return true;
    });
    expect(question).toContain('3 instances');
    expect(plan.edits).toEqual([{ prop: 'x', value: 5, replace: true }]);
  });

  it('blocks spreads and position-based placement', () => {
    expect(
      planEdits(info({ name: '...', code: '{...props}' }), [{ prop: 'x', value: 1 }], 1, never).blocked,
    ).toBeTruthy();
    expect(planEdits(info(expression('position', '{p}')), [{ prop: 'y', value: 1 }], 1, never).blocked).toBeTruthy();
  });
});

describe('planEdits with orientation ternaries', () => {
  const branchy: PropInfo = {
    name: 'y',
    code: '{isPortrait ? popupY : 360}',
    branch: {
      test: 'isPortrait',
      portrait: { code: 'popupY', edit: { value: 650, via: 'const', constName: 'popupY', constRefs: 1 } },
      landscape: { code: '360', edit: { value: 360, via: 'literal' } },
    },
  };

  it('edits only the current orientation side', () => {
    expect(planEdits(info(branchy), [{ prop: 'y', value: 400 }], 1, never, 'landscape').edits).toEqual([
      { prop: 'y', value: 400, branch: 'landscape' },
    ]);
    expect(planEdits(info(branchy), [{ prop: 'y', value: 700 }], 1, never, 'portrait').edits).toEqual([
      { prop: 'y', value: 700, branch: 'portrait' },
    ]);
  });

  it('asks before overwriting an expression side, naming the side', () => {
    let question = '';
    const exprSide: PropInfo = { ...branchy, branch: { ...branchy.branch!, landscape: { code: 'h / 2' } } };
    const plan = planEdits(info(exprSide), [{ prop: 'y', value: 1 }], 1, (q) => ((question = q), true), 'landscape');
    expect(question).toContain('landscape side');
    expect(plan.edits).toEqual([{ prop: 'y', value: 1, branch: 'landscape', replace: true }]);
  });

  it('sourceNumber reads the side for the orientation', () => {
    expect(sourceNumber(info(branchy), 'y', 'portrait')).toBe(650);
    expect(sourceNumber(info(branchy), 'y', 'landscape')).toBe(360);
    expect(sourceNumber(info(expression('x', '{w}')), 'x', 'portrait')).toBeUndefined();
  });
});

describe('planEdits with offsets', () => {
  const OFFSET: ElementInfo = {
    src: 'List.tsx:4:7',
    tag: 'pixiText',
    hash: 'h',
    movable: true,
    inLoop: false,
    props: [
      { name: 'y', code: '{40 + i * 100}', edit: { value: 40, via: 'offset', expr: '40 + i * 100' } },
      { name: 'width', code: '{base + 10}', edit: { value: 10, via: 'offset', expr: 'base + 10' } },
    ],
  };

  it('shifts the term of a moved position without asking, even in a loop', () => {
    const asked: string[] = [];
    const plan = planEdits(OFFSET, [{ prop: 'y', value: 48, mode: 'add' }], 3, (q) => (asked.push(q), true));
    expect(plan.edits).toEqual([{ prop: 'y', value: 48, branch: undefined }]);
    expect(asked).toEqual([]);
    expect(sourceNumber(OFFSET, 'y', 'portrait')).toBe(40);
  });

  it('treats a scaled offset as an expression: the term alone does not scale the sum', () => {
    expect(sourceNumber(OFFSET, 'width', 'portrait', 'mul')).toBeUndefined();
    const plan = planEdits(OFFSET, [{ prop: 'width', value: 300, mode: 'mul' }], 1, () => false);
    expect(plan).toEqual({ edits: [], reverted: ['width'] });
  });
});

describe('planEdits for one item of a .map', () => {
  it('writes the change for that index only, without asking about the shared expression', () => {
    const looped: ElementInfo = { ...info({ name: 'y', code: '{40 + i * 100}' }), inLoop: true };
    const asked: string[] = [];
    const plan = planEdits(looped, [{ prop: 'y', value: 70 }], 3, (q) => (asked.push(q), true), 'portrait', 0);
    expect(plan.edits).toEqual([{ prop: 'y', value: 70, instance: 0 }]);
    expect(asked).toEqual([]);
  });
});
