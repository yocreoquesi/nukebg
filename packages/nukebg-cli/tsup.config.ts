import { defineConfig } from 'tsup';

// ---------------------------------------------------------------------------
// nukebg-cli build config (design §A.7, tasks.md 19.5).
//
// Single-file ESM bundle at dist/cli.js. `onnxruntime-node` and `sharp` are
// externalized because both ship native `.node` addons resolved via
// runtime-relative `require()`/dynamic-require calls that break when
// esbuild inlines them into a bundle — they must stay resolvable from
// nukebg-cli's own node_modules at install time instead.
//
// No `banner` option here: `src/cli.ts` already starts with its own
// `#!/usr/bin/env node` shebang, and tsup auto-detects and preserves an
// entry file's existing shebang as line 1 of the bundle. Adding a `banner.js`
// shebang on top of that produced a DUPLICATE shebang line — line 2 is not
// a valid hashbang position, so V8 throws `SyntaxError: Invalid or
// unexpected token` when the bundle is executed. Verified via
// `node dist/cli.js --version` before removing the banner.
// ---------------------------------------------------------------------------

export default defineConfig({
  // Two entries: the CLI and the pipeline worker it spawns. The worker MUST
  // be its own emitted file — worker_threads needs a real path on disk, and
  // worker-pipeline-runner.ts resolves it as a sibling of the bundle.
  entry: { cli: 'src/cli.ts', 'pipeline.worker': 'src/runners/pipeline.worker.ts' },
  format: ['esm'],
  // node22, not node20: commander 15 is ESM-only and declares
  // `engines.node >= 22.12.0`. The CLI's own floor moved to match — see
  // package.json `engines` and REQ-DIST-3. Keep the two in step; a target
  // below the engines floor silently down-levels for a runtime we no
  // longer claim to support.
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  shims: true,
  external: ['onnxruntime-node', 'sharp'],
});
