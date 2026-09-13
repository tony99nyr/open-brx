import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: the Python MC server (python -m brx_mcp.mc) listens on :8765; proxy the API + UI feed to it.
//
// `MC_PROXY_PORT` moves that target without a second config file (2026-09-13). `test/e2e/koth.mjs`
// runs `npm run dev` — deliberately, it is the command the owner types — and until now that pinned
// the whole suite to :8765, which made koth the ONE suite a parallel worker could not run: two lanes
// would drive each other's server. Two regressions hid behind that in a single day. Every other e2e
// suite already points its own vite at its own MC; this lets koth do the same without giving up the
// property that it starts the real dev server.
const MC = process.env.MC_PROXY_PORT || '8765';
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${MC}`,
      '/ui-ws': { target: `ws://localhost:${MC}`, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
