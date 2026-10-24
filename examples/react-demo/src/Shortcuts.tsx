import type { Graphics } from 'pixi.js';
import { COLORS, drawBox, drawSlab, pixelText } from './theme';

const WIDTH = 440;
const HEIGHT = 400;

const KEYS = [
  { key: 'F2', does: 'Select mode' },
  { key: 'Ctrl Z', does: 'Undo' },
  { key: 'Arrows', does: 'Nudge' },
  { key: 'Del', does: 'Delete' },
];

const headingStyle = pixelText(44);
const keyStyle = pixelText(28);
const doesStyle = pixelText(34);

const drawPanel = (g: Graphics) => {
  g.clear();
  drawBox(g, WIDTH, HEIGHT);
  drawSlab(g, 16, 16, WIDTH - 32, 72, COLORS.blue);
  g.roundRect(16, 104, WIDTH - 32, HEIGHT - 120, 12).fill(COLORS.inner);
  KEYS.forEach((_, i) => drawSlab(g, 36, 124 + i * 64, 132, 46, COLORS.orange));
};

/** The editor's keyboard shortcuts, as key caps. */
export function Shortcuts({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <pixiContainer label={label} x={x} y={y}>
      <pixiGraphics draw={drawPanel} />
      <pixiText text="Shortcuts" x={WIDTH / 2} y={54} anchor={0.5} style={headingStyle} />
      {KEYS.map(({ key, does }, i) => (
        <pixiContainer key={key} y={147 + i * 64}>
          <pixiText text={key} x={102} anchor={0.5} style={keyStyle} />
          <pixiText text={does} x={190} anchor={{ x: 0, y: 0.5 }} style={doesStyle} />
        </pixiContainer>
      ))}
    </pixiContainer>
  );
}
