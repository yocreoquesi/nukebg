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
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default tseslint.config(
  {
    ignores: [
      'packages/nukebg-app/dist/**',
      'packages/nukebg-app/coverage/**',
      'packages/nukebg-app/.halo-check/**',
      'packages/nukebg-app/test-results/**',
      'packages/nukebg-app/playwright-report/**',
      'node_modules/**',
      'packages/*/node_modules/**',
      'packages/nukebg-app/public/service-worker.js',
      // i18n/index.ts has hand-maintained \uXXXX escapes and a giant
      // translation dictionary — let the key-parity test guard it
      // instead of linting.
      'packages/nukebg-app/src/i18n/index.ts',
      'packages/nukebg-app/scripts/**',
      'packages/nukebg-app/e2e/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'no-unsanitized': noUnsanitized },
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

      // Defense-in-depth against XSS from `innerHTML` / `outerHTML`. The
      // current codebase is safe (audit on PR #257 confirmed every site
      // uses static templates, trusted i18n via `t()`, or internal
      // numeric state — never user input). This rule prevents future
      // regressions: any new dynamic innerHTML assignment trips lint
      // unless explicitly disabled with a // eslint-disable-next-line
      // comment that documents why the input is trusted. See
      // CONTRIBUTING.md > "innerHTML policy" for the full convention.
      //
      // `escape.methods` whitelists the i18n translator: `t(...)` returns
      // strings sourced from `src/i18n/index.ts`, a trust boundary the
      // project owns. Adding new escape methods requires the same
      // ownership argument.
      'no-unsanitized/property': [
        'error',
        {
          escape: { methods: ['t'] },
        },
      ],
      'no-unsanitized/method': [
        'error',
        {
          escape: { methods: ['t'] },
        },
      ],
    },
  },
  {
    // Tests get the happy-dom + vitest globals.
    files: ['packages/nukebg-app/tests/**/*.ts'],
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
