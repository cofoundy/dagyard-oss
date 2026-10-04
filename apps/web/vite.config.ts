import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En dev, /api (REST y WebSocket) va al worker local de nucleo (`wrangler dev`, :8787).
// VITE_FIXTURE=1 arranca sin servidor, con el proyecto de ejemplo en memoria.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.DAGYARD_API ?? 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
