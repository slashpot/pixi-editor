import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// diag branch only: the editor plugin is off, to see whether it is what crashes iPad Safari
export default defineConfig({
  plugins: [react()],
});
