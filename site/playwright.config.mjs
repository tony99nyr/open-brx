import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './test/global-setup.mjs',
  use: { baseURL: 'http://localhost:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node serve.mjs', port: 4173, reuseExistingServer: !process.env.CI, timeout: 10_000 },
  // BOTH widths. With only the 1280 project, every phone assertion in the suite was theatre: the
  // anchor-clears-the-header check passed with a flat 72px margin because the desktop header is
  // 64px, and the bug it was written for only exists at 390 where the header is 184px.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 780 } } },
  ],
});
