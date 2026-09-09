import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './test/global-setup.mjs',
  use: { baseURL: 'http://localhost:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node serve.mjs', port: 4173, reuseExistingServer: !process.env.CI, timeout: 10_000 },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
