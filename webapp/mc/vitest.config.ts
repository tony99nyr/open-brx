import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
  },
});
