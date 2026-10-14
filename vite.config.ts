import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    // three.js sozinho já passa dos 500 kB padrão
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
