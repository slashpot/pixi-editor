import type { PaletteItem } from '../shared';
import { EditError } from './ast';
import type { ImportNeed } from './structure';

/** One entry of the Hierarchy's "Add" menu. */
export interface PaletteTemplate extends PaletteItem {
  /** The JSX to insert at (x, y) in the parent's coordinates; `texture` is set when `needsTexture`. */
  jsx(o: { x: number; y: number; texture: string }): string;
  /** Added to the file unless already bound, e.g. `{ name: 'Texture', from: 'pixi.js' }`. */
  imports: ImportNeed[];
}

/**
 * What "Add" can create by default. The intrinsics must already be registered with
 * @pixi/react's `extend()` (Container / Sprite / Text / Graphics) for the inserted JSX to render.
 */
export const DEFAULT_PALETTE: PaletteTemplate[] = [
  {
    kind: 'container',
    label: 'Container',
    needsTexture: false,
    imports: [],
    jsx: ({ x, y }) => `<pixiContainer x={${x}} y={${y}} />`,
  },
  {
    kind: 'sprite',
    label: 'Sprite',
    needsTexture: true,
    imports: [{ name: 'Texture', from: 'pixi.js' }],
    jsx: ({ x, y, texture }) => `<pixiSprite texture={Texture.from('${texture}')} x={${x}} y={${y}} anchor={0.5} />`,
  },
  {
    kind: 'text',
    label: 'Text',
    needsTexture: false,
    imports: [],
    jsx: ({ x, y }) =>
      `<pixiText text="Text" x={${x}} y={${y}} anchor={0.5} style={{ fontSize: 48, fill: '#ffffff' }} />`,
  },
  {
    kind: 'graphics',
    label: 'Graphics (rect)',
    needsTexture: false,
    imports: [],
    jsx: ({ x, y }) =>
      [
        '<pixiGraphics',
        `  x={${x}}`,
        `  y={${y}}`,
        '  draw={(g) => {',
        '    g.clear();',
        '    g.rect(0, 0, 200, 100);',
        "    g.fill({ color: '#ffffff', alpha: 0.5 });",
        '  }}',
        '/>',
      ].join('\n'),
  },
];

export function paletteItems(templates: PaletteTemplate[]): PaletteItem[] {
  return templates.map(({ kind, label, needsTexture }) => ({ kind, label, needsTexture }));
}

export function findTemplate(templates: PaletteTemplate[], kind: string) {
  const found = templates.find((t) => t.kind === kind);
  if (!found) throw new EditError(`Unknown element kind: ${kind}`);
  return found;
}
