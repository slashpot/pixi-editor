import { type Graphics, TextStyle, type TextStyleOptions } from 'pixi.js';

/** Loaded in main.tsx before the first render, so Pixi measures text with it. */
export const FONT = 'Pixelify Sans';

/** A dimly lit card table: slate panels, bright chunky accents. */
export const COLORS = {
  white: '#ffffff',
  red: '#fe5f55',
  blue: '#009dff',
  orange: '#ff9800',
  gold: '#f5b143',
  panel: '#3a4b4e',
  panelEdge: '#5b7377',
  inner: '#1f2b2d',
  shadow: '#000000',
};

/** The hard, unblurred shadow under all of the table's text. */
const textShadow = { color: COLORS.shadow, alpha: 0.55, angle: Math.PI / 2, distance: 4, blur: 0 };

export function pixelText(fontSize: number, fill = COLORS.white, extra: TextStyleOptions = {}) {
  return new TextStyle({ fontFamily: FONT, fontSize, fill, dropShadow: textShadow, ...extra });
}

/** A rounded box sitting on its own drop shadow, with a lighter rim: the base of every panel. */
export function drawBox(g: Graphics, width: number, height: number, color = COLORS.panel, radius = 18) {
  g.roundRect(0, 8, width, height, radius).fill({ color: COLORS.shadow, alpha: 0.4 });
  g.roundRect(0, 0, width, height, radius).fill(color).stroke({ color: COLORS.panelEdge, width: 4, alignment: 1 });
}

/** A flat coloured slab with a darker lip underneath, for headings and key caps. */
export function drawSlab(g: Graphics, x: number, y: number, width: number, height: number, color: string) {
  g.roundRect(x, y + 6, width, height, 12).fill({ color: COLORS.shadow, alpha: 0.35 });
  g.roundRect(x, y, width, height, 12).fill(color);
}
