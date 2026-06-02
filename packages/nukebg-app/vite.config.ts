/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve nukebg-core to its TypeScript source during dev and test
      // so we don't need a prior `tsc -b` build step.
      'nukebg-core': resolve(__dirname, '../nukebg-core/src/index.ts'),
    },
  },
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
