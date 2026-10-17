import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Desenvolvimento: servidor do Vite somente em 127.0.0.1, com proxy de /api para a
// API local. Em produção o build estático é servido pelo Caddy (não pelo Vite).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
  // Worker do MapLibre como módulo ES (ver MapPage.tsx)
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
