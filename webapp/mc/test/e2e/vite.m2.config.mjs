// A third dev server, for `test/e2e/m2-ui.mjs`: the same app with the proxy pointed at that suite's
// OWN MC (:8796 by default). `vite.config.ts` owns :8765 and `vite.proxy.config.mjs` owns :8792 —
// a suite must never drive a server it did not start.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const MC = process.env.MC_PROXY_PORT || '8796';
export default {
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${MC}`,
      '/ui-ws': { target: `ws://127.0.0.1:${MC}`, ws: true },
    },
  },
};
