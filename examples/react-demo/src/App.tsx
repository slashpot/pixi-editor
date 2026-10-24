import { Application } from '@pixi/react';
import { Scene } from './Scene';

export function App() {
  return (
    <Application
      resizeTo={window}
      background="#11111b"
      antialias
      // the devtools convention; also lets the e2e tests reach the app
      onInit={(app) => (globalThis.__PIXI_APP__ = app)}
    >
      <Scene />
    </Application>
  );
}
