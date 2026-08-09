/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Resolve nukebg-core sub-path imports (e.g. nukebg-core/cv/utils) to core source.
      // This entry must come BEFORE the bare 'nukebg-core' alias so Vite matches it first.
      {
        find: /^nukebg-core\/(.+)$/,
        replacement: resolve(__dirname, '../nukebg-core/src/$1'),
      },
      // Resolve bare 'nukebg-core' to its TypeScript barrel during dev and test
      // so we don't need a prior `tsc -b` build step.
      {
        find: 'nukebg-core',
        replacement: resolve(__dirname, '../nukebg-core/src/index.ts'),
      },
    ],
  },
  build: {
    target: 'es2022',
    // Emit to the repo root `dist/`, not `packages/nukebg-app/dist/`. Vite
    // resolves a relative outDir against the project root, so this climbs out
    // of the package.
    //
    // The deploy contract predates the monorepo: Cloudflare Pages builds from
    // the repo root and looks for `dist/` there, and that setting lives in the
    // Pages dashboard, not in this repo (there is no wrangler.toml). Moving
    // the app under `packages/` in phase 2 pointed the artifact somewhere
    // Pages does not look, so every branch in this chain failed its Pages
    // build while dev and main stayed green.
    //
    // This is a workaround, not the preferred fix. The clean fix is to set the
    // Pages project's root directory to `packages/nukebg-app` and revert this
    // to 'dist' — do that if you have dashboard access, and drop this block.
    //
    // `emptyOutDir` is explicit because Vite will not clean an outDir that
    // sits outside the project root unless told to.
    outDir: '../../dist',
    emptyOutDir: true,
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
