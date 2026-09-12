// A second dev server for `test/e2e/kit-continue.mjs`: the same app, with the proxy pointed at that
// suite's OWN MC (:8792 by default) instead of vite.config.ts's :8765 — so two suites, or a suite and
// the server you are working against, never drive each other's process.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const MC = process.env.MC_PROXY_PORT || '8792';
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
