// diag branch only: served as-is from public/, so Vite neither transforms nor pre-bundles
// pixi.js; the start command copies pixi.js's own prebuilt bundle next to this file
const status = document.getElementById('s');
let n = 0;
setInterval(() => (document.getElementById('t').textContent = 'alive ' + ++n + 's'), 1000);

const { Application, Graphics } = await import('./pixi.min.mjs');
status.textContent = 'pixi.js: loaded, starting renderer';

const app = new Application();
await app.init({ width: 300, height: 200, background: '#2a1f3d' });
document.body.append(app.canvas);
app.stage.addChild(new Graphics().rect(50, 50, 200, 100).fill('#fe5f55'));
status.textContent = `pixi.js: rendering with ${app.renderer.name}`;
