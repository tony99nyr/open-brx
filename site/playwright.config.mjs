import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  globalSetup: './test/global-setup.mjs',
  use: { baseURL: 'http://localhost:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node serve.mjs', port: 4173, reuseExistingServer: !process.env.CI, timeout: 10_000 },
    { command: 'SITE_ROOT=test/out-stale PORT=4174 node serve.mjs', port: 4174, reuseExistingServer: !process.env.CI, timeout: 10_000 },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
