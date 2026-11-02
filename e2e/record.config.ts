import { defineConfig, devices } from '@playwright/test';

/** Records the promo demo video: `pnpm --filter e2e record`. Not part of `pnpm e2e`. */
const size = { width: 1280, height: 720 };

export default defineConfig({
  testDir: 'record',
  testMatch: '*.record.ts',
  outputDir: 'test-results/record',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: size,
    deviceScaleFactor: 1,
    video: { mode: 'on', size },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
