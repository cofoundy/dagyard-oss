import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En dev, /api (REST y WebSocket) va al worker local de nucleo (`wrangler dev`, :8787).
// VITE_FIXTURE=1 arranca sin servidor, con el proyecto de ejemplo en memoria.
const api = process.env.DAGYARD_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: api,
        changeOrigin: true,
        ws: true,
        // con la cookie, el Worker exige su mismo origen en el WebSocket y en las escrituras: el proxy se lo da
        configure: (proxy) => {
          const origin = new URL(api).origin;
          proxy.on('proxyReqWs', (req) => req.setHeader('origin', origin));
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', origin);
          });
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
