import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// diag branch only: the demo inside the pnpm monorepo, on Vite 7, without the editor plugin and
// without building it, to compare with diag/ipad-control-demo (the same app outside the monorepo)
export default defineConfig({
  plugins: [react()],
});
