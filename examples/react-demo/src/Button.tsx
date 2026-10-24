import { Texture, TextStyle } from 'pixi.js';

const labelStyle = new TextStyle({ fontFamily: 'Arial', fontSize: 40, fontWeight: 'bold', fill: '#1e1e2e' });

interface ButtonProps {
  x: number;
  y: number;
  text: string;
  label?: string;
  onPress?: () => void;
}

/** A reusable button: clicking one on screen selects this call site; click again to reach inside. */
export function Button({ x, y, text, label, onPress }: ButtonProps) {
  return (
    <pixiContainer label={label} x={x} y={y} eventMode="static" cursor="pointer" onPointerTap={onPress}>
      <pixiSprite texture={Texture.from('button')} anchor={0.5} />
      <pixiText text={text} anchor={0.5} y={-4} style={labelStyle} />
    </pixiContainer>
  );
}
