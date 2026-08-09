/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  // Transformers.js gestiona su propio ONNX Runtime internamente
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
  },
});
