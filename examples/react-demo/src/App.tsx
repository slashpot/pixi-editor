import { Application } from '@pixi/react';
import { Backdrop } from './Backdrop';
import { CloseEditor } from './CloseEditor';
import { editorOn } from './editorMode';
import { Scene } from './Scene';

export function App() {
  return (
    <>
      <Application
        resizeTo={window}
        background="#17121f"
        antialias
        // the devtools convention; also lets the e2e tests reach the app
        onInit={(app) => (globalThis.__PIXI_APP__ = app)}
      >
        <Backdrop />
        <Scene />
      </Application>
      {/* the editor only exists on the dev server */}
      {import.meta.env.DEV && editorOn && <CloseEditor />}
    </>
  );
}
