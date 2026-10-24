import '@fontsource/pixelify-sans/700.css';
import { extend } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FONT } from './theme';

// the pixi intrinsics the scene (and the editor's "Add" menu) uses
extend({ Container, Graphics, Sprite, Text });

const assets = [
  { alias: 'background', src: 'assets/background.svg' },
  { alias: 'button', src: 'assets/button.svg' },
  { alias: 'star', src: 'assets/star.svg' },
];

// Pixi measures text once, so the font must be ready before the first render
void Promise.all([Assets.load(assets), document.fonts.load(`40px "${FONT}"`)]).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
