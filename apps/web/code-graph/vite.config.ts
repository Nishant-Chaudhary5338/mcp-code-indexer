import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 127.0.0.1 (not localhost): the indexer binds to the IPv4 loopback only, and
// "localhost" can resolve to ::1 (IPv6) first on macOS → proxy ECONNREFUSED.
const INDEXER_SERVER = 'http://127.0.0.1:3002';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    proxy: {
      '/api': INDEXER_SERVER,
      '/ws': { target: INDEXER_SERVER, ws: true },
    },
  },
});
