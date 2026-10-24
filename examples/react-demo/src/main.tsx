import { extend } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// the pixi intrinsics the scene (and the editor's "Add" menu) uses
extend({ Container, Graphics, Sprite, Text });

const assets = [
  { alias: 'background', src: 'assets/background.svg' },
  { alias: 'button', src: 'assets/button.svg' },
  { alias: 'star', src: 'assets/star.svg' },
];

void Assets.load(assets).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
