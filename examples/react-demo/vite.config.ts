import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pixiUiEditor } from 'vite-plugin-pixi-ui-editor';

export default defineConfig({
  // pixiUiEditor() only runs on the dev server; open http://localhost:5173/?editor
  plugins: [react(), pixiUiEditor()],
});
