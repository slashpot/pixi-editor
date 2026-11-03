import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { pixiUiEditor } from 'vite-plugin-pixi-ui-editor';
import { VARIANT } from './src/diagVariant';

/** Prints what src/diag.ts posts to the terminal, with this server's heap (diag branch only). */
function diagLog(): Plugin {
  return {
    name: 'diag-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__diag', (req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const heapMB = Math.round(process.memoryUsage().heapUsed / 2 ** 20);
          try {
            const { id, t, event, data } = JSON.parse(body);
            console.log(
              `[diag ${id} +${t}ms heap ${heapMB}MB] ${event}${data === undefined ? '' : ' ' + JSON.stringify(data)}`,
            );
          } catch {
            console.log(`[diag heap ${heapMB}MB] ${body}`);
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  // pixiUiEditor() only runs on the dev server; open http://localhost:5173/?editor,
  // or press the demo's "Open editor" button (src/EditorButton.tsx)
  plugins: [react(), pixiUiEditor(), diagLog()],
  server: { ws: VARIANT.noHmr ? false : undefined },
});
