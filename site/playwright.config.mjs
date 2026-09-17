import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

/** Memory the OS can hand out now, in MB. Linux reads MemAvailable; elsewhere (macOS counts cache as used, so
 *  os.freemem() is far too low) half of the total stands in for it. */
const availableMb = () => {
  try { return Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024; }
  catch { return os.totalmem() / 1048576 / 2; }
};
// Workers (2026-09-16). Playwright's default is half the cores, and every worker is its own browser, ~200-300 MB:
// 16 workers took 19 s and 3.1 GB, 8 took 23 s and 2.4 GB. So: half the cores, at most 8, and never more than a
// quarter of the free memory. `--workers=N` still overrides.
const WORKERS = Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2), Math.floor(availableMb() * 0.25 / 300)));

// The static server's port (2026-09-16). It was a fixed :4173 with `reuseExistingServer`, so a second checkout (a
// worktree, a parallel agent) running this suite silently tested the FIRST checkout's build, on its server. The runner
// now picks a free port once and exports it; the worker processes inherit the env var, so they read the same port.
if (!process.env.SITE_TEST_PORT) {
  process.env.SITE_TEST_PORT = String(await new Promise((resolve, reject) => {
    const s = net.createServer(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  }));
}
const PORT = Number(process.env.SITE_TEST_PORT);
export default defineConfig({
  testDir: './test',
  timeout: 60_000,
  // Every test, not every file, is a unit of parallelism (2026-09-16): 2 files x 2 projects capped the run at 4
  // workers, ~52 s. Tests share no state (each gets its own page and context), so this is ~25 s.
  fullyParallel: true,
  workers: WORKERS,
  reporter: [['list']],
  globalSetup: './test/global-setup.mjs',
  use: { baseURL: `http://127.0.0.1:${PORT}`, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node serve.mjs', port: PORT, env: { PORT: String(PORT) }, reuseExistingServer: false, timeout: 10_000 },
  // BOTH widths. With only the 1280 project, every phone assertion in the suite was theatre: the
  // anchor-clears-the-header check passed with a flat 72px margin because the desktop header is
  // 64px, and the bug it was written for only exists at 390 where the header is 184px.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 780 } } },
  ],
});
