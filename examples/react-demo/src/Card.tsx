import { useTick } from '@pixi/react';
import type { Container, Graphics, Ticker } from 'pixi.js';
import { useCallback, useRef } from 'react';
import { pixelText } from './theme';

const WIDTH = 150;
const HEIGHT = 210;

type Suit = '♠' | '♥' | '♣' | '♦';

const SUIT_COLORS: Record<Suit, string> = { '♠': '#3c4368', '♥': '#f03464', '♣': '#235955', '♦': '#f06b3f' };

const styles = (color: string) => ({
  rank: pixelText(44, color, { dropShadow: false }),
  pip: pixelText(30, color, { dropShadow: false }),
  center: pixelText(96, color, { dropShadow: false }),
});
const STYLES = Object.fromEntries(Object.entries(SUIT_COLORS).map(([suit, color]) => [suit, styles(color)]));

const drawFace = (g: Graphics) => {
  g.clear();
  g.roundRect(-WIDTH / 2 + 6, -HEIGHT / 2 + 10, WIDTH, HEIGHT, 14).fill({ color: '#000000', alpha: 0.35 });
  g.roundRect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT, 14)
    .fill('#f4efe4')
    .stroke({ color: '#bdb3a2', width: 3, alignment: 1 });
};

interface CardProps {
  x: number;
  y: number;
  rank: string;
  suit: Suit;
  angle?: number;
  label?: string;
}

/**
 * A playing card, centred on (x, y), that idly bobs up and down. A reusable component:
 * clicking one on screen selects this call site; click again to reach inside.
 */
export function Card({ x, y, rank, suit, angle = 0, label }: CardProps) {
  const face = useRef<Container>(null);
  const time = useRef(0);
  // each card bobs out of step with the others, by where it sits
  const bob = useCallback(
    (ticker: Ticker) => {
      time.current += ticker.deltaMS / 1000;
      if (face.current) face.current.y = 6 * Math.sin(1.6 * time.current + x / 90);
    },
    [x],
  );
  useTick(bob);

  const style = STYLES[suit];
  return (
    <pixiContainer label={label} x={x} y={y} angle={angle}>
      <pixiContainer ref={face}>
        <pixiGraphics draw={drawFace} />
        <pixiText text={rank} x={-62} y={-100} style={style.rank} />
        <pixiText text={suit} x={-60} y={-52} style={style.pip} />
        <pixiText text={suit} anchor={0.5} y={14} style={style.center} />
      </pixiContainer>
    </pixiContainer>
  );
}
