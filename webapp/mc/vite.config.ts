import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: the Python MC server (python -m brx_mcp.mc) listens on :8765; proxy the API + UI feed to it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8765',
      '/ui-ws': { target: 'ws://localhost:8765', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
