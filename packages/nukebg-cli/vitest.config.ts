import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Resolve nukebg-core sub-path imports to core source (must come before bare alias)
      {
        find: /^nukebg-core\/(.+)$/,
        replacement: resolve(__dirname, '../nukebg-core/src/$1'),
      },
      // Resolve bare 'nukebg-core' to its TypeScript barrel (no pre-built dist required)
      {
        find: 'nukebg-core',
        replacement: resolve(__dirname, '../nukebg-core/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
