// ESLint flat config. Intentionally lean — the TypeScript strict mode
// (tsconfig.json) does the heavy type-level lifting; ESLint's job here
// is to catch runtime footguns the compiler can't see and to enforce
// a few project conventions.
//
// Expansion path: add stricter rules one by one, run `npm run lint:fix`,
// open a focused PR. Avoid bulk-enabling rulesets like
// plugin:@typescript-eslint/strict in one go — the noise drowns the
// review.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.halo-check/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      'public/service-worker.js',
      'exploration/**',
      // i18n/index.ts has hand-maintained \uXXXX escapes and a giant
      // translation dictionary — let the key-parity test guard it
      // instead of linting.
      'src/i18n/index.ts',
      'scripts/**',
      'e2e/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // TS compiler already enforces noUnusedLocals / noUnusedParameters.
      // Turn the ESLint equivalent off so we don't double-report.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',

      // `any` is sometimes inevitable (ONNX tensor data, postMessage
      // payloads at the IPC boundary). Keep as warning, not error, so
      // a sweep to remove them can be done over time.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Project runs strict types already — non-null assertions are a
      // deliberate shortcut used across components for querySelector
      // results that are guaranteed to exist inside render() output.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Enforce === over ==.
      eqeqeq: ['error', 'always'],
      // Prefer const when binding is not reassigned.
      'prefer-const': 'error',
      // No var declarations.
      'no-var': 'error',
    },
  },
  {
    // Tests get the happy-dom + vitest globals.
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Test files frequently narrow types with assertions on fixture
      // data; be lenient.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
