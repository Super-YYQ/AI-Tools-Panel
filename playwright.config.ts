import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  globalTimeout: 600_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
  },
});
