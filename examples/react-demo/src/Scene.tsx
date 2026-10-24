import { type Graphics, Texture, TextStyle } from 'pixi.js';
import { Card } from './Card';
import { EditorButton } from './EditorButton';
import { Shortcuts } from './Shortcuts';
import { COLORS, drawBox, drawSlab, FONT, pixelText } from './theme';
import { useScreen } from './useScreen';

/** The scene is laid out in these design units and scaled to fit the window. */
const DESIGN = { portrait: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } };

/** The centre column (title, cards, editor button) keeps its own layout; only its place in the scene depends on the orientation. */
const CENTER_WIDTH = 1080;

const titleStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 112,
  fill: COLORS.white,
  stroke: { color: COLORS.inner, width: 14 },
  dropShadow: { color: COLORS.shadow, alpha: 0.6, angle: Math.PI / 2, distance: 10, blur: 0 },
});
const subtitleStyle = pixelText(36, COLORS.gold);
const headingStyle = pixelText(44);
const itemStyle = pixelText(40);

/** Both cards sit on this row: dragging one asks whether the other should move too. */
const CARD_Y = 600;

const ITEMS = ['Drag me', 'Edit me', 'Undo me'];

const drawPanel = (g: Graphics) => {
  g.clear();
  drawBox(g, 440, 400);
  drawSlab(g, 16, 16, 408, 72, COLORS.red);
  g.roundRect(16, 104, 408, 280, 12).fill(COLORS.inner);
};

export function Scene() {
  const { width, height, isPortrait } = useScreen();
  const design = isPortrait ? DESIGN.portrait : DESIGN.landscape;
  const scale = Math.min(width / design.width, height / design.height);

  return (
    <pixiContainer
      label="scene"
      x={(width - design.width * scale) / 2}
      y={(height - design.height * scale) / 2}
      scale={scale}
    >
      <pixiContainer label="panel" x={isPortrait ? 60 : 220} y={isPortrait ? 1360 : 380}>
        <pixiGraphics draw={drawPanel} />
        <pixiText label="heading" text="Try the editor" x={220} y={50} anchor={0.5} style={headingStyle} />
        {ITEMS.map((item, i) => (
          <pixiText key={item} label={`item-${i}`} text={item} x={40} y={130 + i * 80} style={itemStyle} />
        ))}
      </pixiContainer>
      <Shortcuts label="shortcuts" x={isPortrait ? 580 : 1260} y={isPortrait ? 1360 : 380} />

      <pixiContainer label="center" x={isPortrait ? 0 : 420} y={isPortrait ? 250 : 0}>
        <pixiText label="title" text="Pixi UI Editor" x={CENTER_WIDTH / 2} y={150} anchor={0.5} style={titleStyle} />
        <pixiText label="subtitle" text="Edit your scene live" x={540} y={250} anchor={0.5} style={subtitleStyle} />
        <Card label="ace" x={345} y={CARD_Y} angle={-10} rank="A" suit="♠" />
        <Card label="king" x={735} y={CARD_Y} angle={10} rank="K" suit="♥" />
        <pixiSprite label="star" texture={Texture.from('star')} x={540} y={570} anchor={0.5} />
        <EditorButton label="editor" x={540} y={900} />
      </pixiContainer>
    </pixiContainer>
  );
}
