import type { Application } from 'pixi.js';

declare global {
  /** The @pixi/devtools convention for exposing the app. */
  var __PIXI_APP__: Application | undefined;
}
