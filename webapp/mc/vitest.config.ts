import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import { defineConfig } from 'vitest/config';

/** Memory the OS can hand out now, in MB. Linux reads MemAvailable; elsewhere (macOS counts cache as used, so
 *  os.freemem() is far too low) half of the total stands in for it. */
const availableMb = (): number => {
  try { return Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))![1]) / 1024; }
  catch { return os.totalmem() / 1048576 / 2; }
};
// Workers (2026-09-16). The default is one fewer than the cores, and each jsdom worker holds ~300 MB: 31 workers on
// the 32-core dev box is ~8 GB for a 7 s suite. 8 workers take 8 s and 2.5 GB, 16 take 6 s and 4.3 GB. So: half the
// cores, at most 8, and never more than a quarter of the free memory. `--maxWorkers=N` still overrides.
const WORKERS = Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2), Math.floor(availableMb() * 0.25 / 300)));

// W5: the MC console had no test script at all. jsdom + the real React renderer is enough to mount
// every screen against a fixture — no browser, no server, ~1s. The full-stack UI proof (real
// widgets, a real MC, two phone HUDs) stays in `app/tools/e2e.mjs`; this is the gate that runs
// before it is worth starting.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    maxWorkers: WORKERS,
  },
});
