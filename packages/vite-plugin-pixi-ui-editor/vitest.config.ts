import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'vite-plugin-pixi-ui-editor',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
