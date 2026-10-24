import { Texture, TextStyle } from 'pixi.js';
import { useState } from 'react';
import { Button } from './Button';
import { useScreen } from './useScreen';

/** The scene is laid out in these design units and scaled to fit the window. */
const DESIGN = { portrait: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } };

const titleStyle = new TextStyle({ fontFamily: 'Arial', fontSize: 96, fontWeight: 'bold', fill: '#cdd6f4' });
const itemStyle = new TextStyle({ fontFamily: 'Arial', fontSize: 40, fill: '#bac2de' });

/** Both buttons sit on this row: dragging one asks whether the other should move too. */
const BUTTON_ROW_Y = 820;

const ITEMS = ['Drag me', 'Edit me', 'Undo me'];

export function Scene() {
  const { width, height, isPortrait } = useScreen();
  const design = isPortrait ? DESIGN.portrait : DESIGN.landscape;
  const scale = Math.min(width / design.width, height / design.height);
  const [presses, setPresses] = useState(0);

  return (
    <pixiContainer
      label="scene"
      x={(width - design.width * scale) / 2}
      y={(height - design.height * scale) / 2}
      scale={scale}
    >
      <pixiSprite label="background" texture={Texture.from('background')} width={design.width} height={design.height} />

      <pixiText label="title" text="Pixi UI Editor" x={design.width / 2} y={140} anchor={0.5} style={titleStyle} />
      <pixiSprite label="star" texture={Texture.from('star')} x={180} y={140} anchor={0.5} />

      <pixiContainer label="panel" x={isPortrait ? 140 : 1100} y={isPortrait ? 1000 : 300}>
        <pixiGraphics
          draw={(g) => {
            g.clear();
            g.roundRect(0, 0, 680, 360, 24);
            g.fill({ color: '#313244', alpha: 0.9 });
          }}
        />
        {ITEMS.map((item, i) => (
          <pixiText key={item} label={`item-${i}`} text={item} x={40} y={40 + i * 100} style={itemStyle} />
        ))}
      </pixiContainer>

      <Button label="play" x={300} y={BUTTON_ROW_Y} text="Play" onPress={() => setPresses((n) => n + 1)} />
      <Button label="settings" x={700} y={BUTTON_ROW_Y} text={`Pressed ${presses}`} />
    </pixiContainer>
  );
}
