import type { ElementInfo, Orientation, PropEdit, PropInfo, ValueEdit } from '../shared';

/**
 * A value the gizmo wants to persist, e.g. `{ prop: 'x', value: 130 }`.
 * `mode` says how it was derived from the source: `add` (source + drag delta: positions)
 * or `mul` (source × drag ratio: sizes, scale). Defaults to `add`.
 */
export interface Change {
  prop: string;
  value: number;
  mode?: ChangeMode;
}

export type ChangeMode = 'add' | 'mul';

export interface Plan {
  edits: PropEdit[];
  /** Props the user declined to overwrite — the gizmo puts the live object back. */
  reverted: string[];
  /** Set when the change can't be written at all. */
  blocked?: string;
}

/** The orientation apps usually derive from the viewport (`isPortrait = height > width`). */
export function currentOrientation(): Orientation {
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}

/**
 * The number the source currently gives `prop` (for this orientation), when it is
 * a literal or a const. The gizmo adds its drag delta to this rather than writing
 * the Pixi object's value, so components that transform their props still get
 * the right number. The term of an offset (`40` in `40 + i * 100`) only counts
 * for `add`: shifting the term shifts the sum, scaling it doesn't scale the sum.
 */
export function sourceNumber(
  info: ElementInfo,
  prop: string,
  orientation: Orientation,
  mode: ChangeMode = 'add',
): number | undefined {
  const p = info.props.find((x) => x.name === prop);
  const edit = p?.branch ? p.branch[orientation].edit : p?.edit;
  if (edit?.via === 'offset' && mode !== 'add') return undefined;
  return typeof edit?.value === 'number' ? edit.value : undefined;
}

/**
 * Decides how each dragged value is written back:
 * - missing attribute / literal / single-use const → edit in place
 * - const shared by several props → ask: move them all, or detach this one into a literal
 * - `40 + i * 100` (moving) → shift the number term, keeping the expression (and a loop's spacing)
 * - `isPortrait ? a : b` → the same rules, applied to the current orientation's side only
 * - expression → ask: overwrite with a literal, or revert
 *
 * `instances` = live display objects rendered from this JSX element (> 1 inside a `.map`).
 * `instance` = write the changes for that one item of the `.map` only (see `PropEdit.instance`).
 */
export function planEdits(
  info: ElementInfo,
  changes: Change[],
  instances: number,
  ask: (question: string) => boolean,
  orientation: Orientation = 'portrait',
  instance?: number,
): Plan {
  const plan: Plan = { edits: [], reverted: [] };
  const has = (name: string) => info.props.some((p) => p.name === name);

  if (has('...')) {
    plan.blocked =
      'This element has {...spread} props, so where its values come from is unknown; dragging cannot write it back';
    return plan;
  }
  if (changes.some((c) => c.prop === 'x' || c.prop === 'y') && has('position')) {
    plan.blocked = 'This element is positioned with the position prop; edit it in the Inspector or the source';
    return plan;
  }
  // one instance of a `.map`: its own case in the source, whatever the shared expression is
  if (instance !== undefined) {
    plan.edits = changes.map(({ prop, value }) => ({ prop, value, instance }));
    return plan;
  }

  for (const change of changes) {
    const edit = planOne(
      info.props.find((p) => p.name === change.prop),
      change,
      instances,
      ask,
      orientation,
    );
    if (edit) plan.edits.push(edit);
    else plan.reverted.push(change.prop);
  }
  return plan;
}

/** undefined = the user chose to revert this prop. */
function planOne(
  current: PropInfo | undefined,
  { prop, value, mode = 'add' }: Change,
  instances: number,
  ask: (question: string) => boolean,
  orientation: Orientation,
): PropEdit | undefined {
  if (!current) return { prop, value };

  const side = current.branch?.[orientation];
  const branch = side ? orientation : undefined;
  const sideName = orientation === 'portrait' ? 'portrait' : 'landscape';
  const where = side ? `${prop} (${sideName} side)` : prop;
  const edit: ValueEdit | undefined = side ? side.edit : current.edit;
  const code = side ? side.code : current.code;

  if (edit?.via === 'literal' && typeof edit.value === 'number') return { prop, value, branch };
  if (edit?.via === 'offset' && mode === 'add') return { prop, value, branch };

  if (edit?.via === 'const' && typeof edit.value === 'number') {
    const refs = edit.constRefs ?? 1;
    const moveAll =
      refs <= 1 ||
      ask(
        `${where} uses const ${edit.constName} (shared by ${refs}).\n\n` +
          `OK: edit the const; the other ${refs - 1} move too\nCancel: change only this one, to the literal ${value}`,
      );
    return moveAll ? { prop, value, branch } : { prop, value, branch, replace: true };
  }

  const loopNote =
    instances > 1
      ? `\n\nNote: this element has ${instances} instances on screen (rendered in a loop); a literal gives them all the same value.`
      : '';
  const overwrite = ask(
    `${where} is the expression ${code}${loopNote}\n\nOK: replace it with the literal ${value}\nCancel: revert`,
  );
  return overwrite ? { prop, value, branch, replace: true } : undefined;
}
