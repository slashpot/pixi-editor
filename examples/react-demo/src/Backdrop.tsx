import { useTick } from '@pixi/react';
import { Texture, type Ticker } from 'pixi.js';
import { createSwirl } from './swirl';
import { useScreen } from './useScreen';

const swirl = createSwirl();
const FILTERS = [swirl];
const animate = (ticker: Ticker) => {
  swirl.resources.swirlUniforms.uniforms.uTime += ticker.deltaMS / 1000;
};

/** The animated paint swirl behind everything; it fills the whole window, past the scene's letterbox. */
export function Backdrop() {
  const { width, height } = useScreen();
  useTick(animate);
  return (
    <pixiSprite
      label="background"
      texture={Texture.from('background')}
      width={width}
      height={height}
      filters={FILTERS}
    />
  );
}
