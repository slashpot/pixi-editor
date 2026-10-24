/**
 * Prop injected into every pixi intrinsic (and project component) JSX element in dev.
 * Value: "<path relative to workspace root>:<line>:<column>" of the opening tag.
 * @pixi/react copies unknown props onto the instance, so the rendered
 * Container carries it as `instance.__src`.
 */
export const SRC_ATTR = '__src';

/** `<pixiSprite>`, `<pixiContainer>`, `<layoutContainer>` … — not DOM tags, not custom components. */
export const PIXI_INTRINSIC_RE = /^(pixi|layout)[A-Z]/;

/** Default query param that turns the editor overlay on: http://localhost:5173/?editor */
export const DEFAULT_QUERY_PARAM = 'editor';

/** Dev-server API mount point (see server/api.ts). */
export const API_BASE = '/__pixi-ui-editor';

/** Header every API request must carry (lower-case, as Node reports it); see server/api.ts. */
export const API_HEADER = 'x-pixi-ui-editor';

/** What the plugin hands the client's `start()`. */
export interface ClientConfig {
  /** Absolute path that `__src` paths are relative to. */
  workspaceRoot: string;
  /** The Vite root relative to `workspaceRoot` ('' when they are the same); clicks prefer elements under it. */
  appRoot: string;
  queryParam: string;
  /** CSS selector of the element the orientation preview boxes. */
  previewRoot: string;
}

export type PropValue = number | string | boolean;

export type Orientation = 'portrait' | 'landscape';

/**
 * How a value can be rewritten in place:
 * - `literal`  `x={680}` / `eventMode="none"` / shorthand `visible`
 * - `const`    `y={popupY}` → edits `const popupY = 680` in the same file
 * - `texture`  `texture={Texture.from('icon_error')}` / `Assets.get('key')` → edits the key
 * - `offset`   `y={40 + i * 100}` → edits the number term (`value` is what it adds: 40),
 *              so dragging shifts the result without flattening the expression
 */
export interface ValueEdit {
  value: PropValue;
  via: 'literal' | 'const' | 'texture' | 'offset';
  constName?: string;
  /** How many places read the const — editing it moves all of them. */
  constRefs?: number;
  /** For `offset`: the whole expression the term belongs to. */
  expr?: string;
}

/** One side of `isPortrait ? a : b`. */
export interface BranchSide {
  code: string;
  edit?: ValueEdit;
}

/**
 * One JSX attribute (or one field of an object-valued attribute) as the inspector sees it.
 * At most one of `edit` / `branch` / `fields` is set; none means read-only.
 */
export interface PropInfo {
  name: string;
  /** Source text of the value (`{...props}` for spreads). */
  code: string;
  edit?: ValueEdit;
  /**
   * `y={isPortrait ? 650 : 360}` — each side editable on its own. `viaConst` when the
   * ternary sits in a same-file const (`const x = isPortrait ? … : …; <… x={x} />`).
   */
  branch?: { test: string; viaConst?: { name: string; refs: number } } & Record<Orientation, BranchSide>;
  /** `anchor={{ x: 0.5, y: 0 }}`, `layout={{ … }}`, `style={textStyle}` → `new TextStyle({ … })`. */
  fields?: PropInfo[];
  /** The object lives in a same-file const, shared by `refs` places. */
  objectConst?: { name: string; refs: number };
}

export interface ElementInfo {
  src: string;
  /** `pixiSprite`, or a component name such as `Button`. */
  tag: string;
  /** Hash of the whole file; edits are rejected (409) if the file changed since. */
  hash: string;
  props: PropInfo[];
  /** Whether the element sits directly inside another JSX element (can be moved / deleted / duplicated). */
  movable: boolean;
  /** Whether it is all a `.map` callback returns, so one instance can get its own values (`PropEdit.instance`). */
  inLoop: boolean;
}

/**
 * Sets `prop` to `value`; inserts the attribute if the element doesn't have it.
 * - `prop` may be a dotted path into an object attribute: `anchor.x`, `layout.width`.
 * - `branch` picks one side of an orientation ternary.
 * - `replace` swaps the whole value for the literal instead of editing the const it
 *   points at — also the only way to overwrite an expression.
 */
export interface PropEdit {
  prop: string;
  value: PropValue;
  branch?: Orientation;
  replace?: boolean;
  /**
   * Give only this instance of a `.map`-rendered element the value (its index in the list):
   * `x={40}` → `x={i === 2 ? 75 : 40}`. `value` must be a number; `branch` / `replace` don't apply.
   */
  instance?: number;
}

/** All edits are applied to the file in one write (one HMR update). */
export interface EditRequest {
  src: string;
  hash: string;
  edits: PropEdit[];
}

/** Where a new / moved element goes, relative to the element at `src`. */
export type Placement = 'before' | 'after' | 'child';

export interface InsertRequest {
  src: string;
  hash: string;
  placement: Placement;
  /** Palette entry id (see server/palette.ts). */
  kind: string;
  x: number;
  y: number;
  /** Texture key for sprite / button templates. */
  texture?: string;
}

export interface MoveRequest {
  src: string;
  hash: string;
  target: string;
  placement: Placement;
}

/** Result of a structural change: where the affected element now lives. */
export interface StructureResult {
  src: string;
  hash: string;
}

export interface PaletteItem {
  kind: string;
  label: string;
  needsTexture: boolean;
}
