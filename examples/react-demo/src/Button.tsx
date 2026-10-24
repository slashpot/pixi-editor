import { Texture } from 'pixi.js';
import { useState } from 'react';
import { COLORS, pixelText } from './theme';

const labelStyle = pixelText(40);

interface ButtonProps {
  x: number;
  y: number;
  text: string;
  /** Tints the (white) button texture. */
  color?: string;
  label?: string;
  onPress?: () => void;
}

/** A chunky button that grows a little under the pointer. */
export function Button({ x, y, text, color = COLORS.orange, label, onPress }: ButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <pixiContainer
      label={label}
      x={x}
      y={y}
      eventMode="static"
      cursor="pointer"
      onPointerTap={onPress}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <pixiContainer scale={hover ? 1.06 : 1}>
        <pixiSprite texture={Texture.from('button')} anchor={0.5} tint={color} />
        <pixiText text={text} anchor={0.5} y={-6} style={labelStyle} />
      </pixiContainer>
    </pixiContainer>
  );
}
