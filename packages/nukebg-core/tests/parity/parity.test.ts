import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { RMBG_PARAMS, compareAlpha } from '../../src/index.js';
import type { ImageDataLike } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Browser <-> Node pixel parity test (REQ-PARITY-1, REQ-PARITY-4)
// ---------------------------------------------------------------------------
//
// Fixture set (packages/nukebg-core/tests/fixtures/parity/ — see the
// README.md there for provenance: these are deterministic SYNTHETIC
// placeholders, not real photographs):
//   - portrait-512x512.png  (mode: photo, skipWatermark: true)
//   - product-800x600.jpg   (mode: photo, skipWatermark: false)
//   - logo-256x256.png      (mode: icon,  skipWatermark: true)
//
// Thresholds (REQ-PARITY-1):
//   - alpha channel: |diff| <= EPSILON_ALPHA (2) for every pixel
//   - pixels with any alpha diff: < 5% of total pixels
//   - RGB in subject pixels (alpha > 0 in BOTH outputs): identical (epsilon 0)
// These numbers are enforced by `compareAlpha`
// (packages/nukebg-core/src/parity/compare-alpha.ts), which is unit tested
// independently and unconditionally in `compare-alpha.test.ts` — that
// suite is green regardless of models/fixtures/skip state.
//
// Skip guard (REQ-PARITY-4): running the real pipeline requires the
// RMBG-1.4 model (~44MB) to be cached on disk. Downloading it on every
// local `npm test` run would be slow and flaky, so this test skips unless
// the model is already cached OR NUKEBG_PARITY_REQUIRE is set.
//
// Known gap (documented, not silently swallowed): REQ-PARITY-4 also calls
// for committed browser-produced reference PNGs to diff Node's output
// against. Producing those requires driving the actual browser pipeline
// (WorkerPipelineRunner, Web Workers, WASM ONNX), which cannot run inside
// a Node vitest process. Until that reference-output generation step
// exists (tracked in tasks.md X.6 / Phase 18), the forced
// (NUKEBG_PARITY_REQUIRE=1) path fails loudly with an actionable message
// per fixture instead of silently skipping or asserting against nothing.

const EPSILON_ALPHA = 2;
const MAX_DIFF_PIXEL_RATIO = 0.05;

const FIXTURES_DIR = resolve(__dirname, '../fixtures/parity');

const FIXTURES = [
  { file: 'portrait-512x512.png', mode: 'photo' as const, skipWatermark: true },
  { file: 'product-800x600.jpg', mode: 'photo' as const, skipWatermark: false },
  { file: 'logo-256x256.png', mode: 'icon' as const, skipWatermark: true },
];

function referencePathFor(fixtureFile: string): string {
  const stem = fixtureFile.replace(/\.(png|jpe?g)$/i, '');
  return join(FIXTURES_DIR, `${stem}.reference-alpha.png`);
}

/**
 * Best-effort, dependency-free replica of `resolveCacheDir`'s default
 * branch (packages/nukebg-cli/src/runners/cache-dir.ts) — duplicated here
 * (not imported) so this core test has no static dependency on
 * `nukebg-cli` or `env-paths` on the "skip" path. A false negative here
 * (reporting "not cached" when it actually is) just means the test skips
 * instead of running — the safe default per REQ-PARITY-4.
 */
function candidateCacheDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.TRANSFORMERS_CACHE) dirs.push(process.env.TRANSFORMERS_CACHE);
  if (process.env.HF_HOME) dirs.push(process.env.HF_HOME);
  if (process.platform === 'darwin') {
    dirs.push(join(homedir(), 'Library', 'Caches', 'nukebg'));
  } else if (process.platform === 'win32') {
    dirs.push(
      join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'nukebg', 'Cache'),
    );
  } else {
    dirs.push(join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'nukebg'));
  }
  return dirs;
}

function isRmbgModelCached(): boolean {
  return candidateCacheDirs().some((dir) =>
    existsSync(join(dir, 'briaai', 'RMBG-1.4', RMBG_PARAMS.REVISION, 'onnx', 'model_quantized.onnx')),
  );
}

async function loadImageFromPath(path: string): Promise<ImageDataLike> {
  const { data, info } = await sharp(readFileSync(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

const modelCached = isRmbgModelCached();
const forceRequired = Boolean(process.env.NUKEBG_PARITY_REQUIRE);
const shouldSkip = !modelCached && !forceRequired;

describe('Browser<->Node pixel parity (REQ-PARITY-1, REQ-PARITY-4)', () => {
  if (shouldSkip) {
    // eslint-disable-next-line vitest/expect-expect -- intentional skip stub, no assertions
    it.skip('Skipping parity test — RMBG model not cached (set NUKEBG_PARITY_REQUIRE=1 to force)', () => {});
    return;
  }

  for (const fixture of FIXTURES) {
    it(`matches within epsilon for ${fixture.file}`, async () => {
      const referencePath = referencePathFor(fixture.file);
      if (!existsSync(referencePath)) {
        throw new Error(
          `Missing committed browser-baseline reference output for ${fixture.file} ` +
            `(expected at ${referencePath}). REQ-PARITY-4 requires a browser-produced ` +
            'reference PNG committed alongside the input fixture; generating one requires ' +
            'driving WorkerPipelineRunner in an actual browser, which this Node-only test ' +
            'cannot do. See packages/nukebg-core/tests/fixtures/parity/README.md.',
        );
      }

      const input = await loadImageFromPath(join(FIXTURES_DIR, fixture.file));
      const reference = await loadImageFromPath(referencePath);

      // Deep relative import into `nukebg-cli`'s source (not the package
      // barrel) — intentional. `nukebg-cli` has not been built (`dist/`
      // does not exist pre-Phase 19) and its public barrel does not yet
      // export the Node runners, so a static/top-level `import ... from
      // 'nukebg-cli'` would fail module resolution as soon as this test
      // FILE loads — even on the skip path above. A dynamic import here,
      // reached only when the guard determined the model IS cached or the
      // run is explicitly forced, keeps the skip path free of any
      // dependency on `nukebg-cli`'s build state.
      const { NodePipelineRunner } = await import(
        '../../../nukebg-cli/src/runners/node-pipeline-runner.js'
      );
      const { OnnxNodeRmbgRunner } = await import('../../../nukebg-cli/src/runners/onnx-node-rmbg.js');
      const { OnnxNodeLamaRunner } = await import('../../../nukebg-cli/src/runners/onnx-node-lama.js');

      const rmbgRunner = new OnnxNodeRmbgRunner();
      const lamaRunner = fixture.skipWatermark ? undefined : new OnnxNodeLamaRunner();
      const runner = new NodePipelineRunner({ rmbgRunner, lamaRunner });

      try {
        const result = await runner.run(input, {
          mode: fixture.mode,
          skipWatermark: fixture.skipWatermark,
        });

        const comparison = compareAlpha(result.output, reference, {
          alphaEpsilon: EPSILON_ALPHA,
          maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
          rgbEpsilon: 0,
        });

        expect(comparison.alphaWithinEpsilon).toBe(true);
        expect(comparison.diffRatioWithinBudget).toBe(true);
        expect(comparison.subjectRgbIdentical).toBe(true);
      } finally {
        await runner.dispose();
      }
    });
  }
});
