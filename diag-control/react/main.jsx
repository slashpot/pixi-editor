import { Application, extend } from '@pixi/react';
import { Graphics } from 'pixi.js';
import { createRoot } from 'react-dom/client';

extend({ Graphics });

let n = 0;
setInterval(() => (document.getElementById('t').textContent = 'alive ' + ++n + 's'), 1000);

const draw = (g) => g.clear().rect(50, 50, 200, 100).fill('#fe5f55');

createRoot(document.getElementById('root')).render(
  <Application width={300} height={200} background="#2a1f3d">
    <pixiGraphics draw={draw} />
  </Application>,
);
