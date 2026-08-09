import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ONNX Runtime Web is pinned, not ranged, and this suite is why.
//
// The workers do NOT bundle the WASM binaries — they point `ort.env.wasm.wasmPaths`
// at a hard-coded jsDelivr URL that names an exact version. So the bundled JS glue
// and the fetched WASM binary are two independently versioned halves of one runtime,
// and nothing at build time notices when they drift apart.
//
// Incident this guards against (Aug 9 2026): a `npm install` run for an unrelated
// dependency fix let the `^1.24.3` range float onnxruntime-web to 1.27.0. Two things
// broke at once and neither was caught by any existing test:
//   1. 1.27.0 emits a 25.6 MiB `ort-wasm-simd-threaded.jsep` asset, over Cloudflare
//      Pages' hard 25 MiB per-file limit — the deploy was rejected outright.
//   2. The 1.27.0 JS glue was pairing with 1.24.3 WASM binaries from the CDN.
//
// Rules enforced here: the dependency is pinned exactly, the CDN URLs agree with it,
// and the lockfile actually resolves to it.
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..', '..');

const appPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const pinned = appPkg.dependencies['onnxruntime-web'];

// `@huggingface/transformers` ships its own pinned onnxruntime-web for its internal
// use. It is a legitimately separate copy and is not what our workers load.
const TRANSFORMERS_NESTED = 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web';

const workerDir = resolve(root, 'src/workers');
const workerFiles = readdirSync(workerDir).filter((f) => f.endsWith('.ts'));

describe(`onnxruntime-web coherence (pinned @ ${pinned})`, () => {
  it('is pinned to an exact version, with no range prefix', () => {
    // A caret here is what caused the Aug 9 incident: the CDN URLs below cannot
    // follow a range, so the dependency must not be allowed to float.
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every hard-coded wasmPaths CDN URL names exactly that version', () => {
    const urls: Array<{ file: string; version: string }> = [];
    for (const file of workerFiles) {
      const src = readFileSync(resolve(workerDir, file), 'utf8');
      for (const m of src.matchAll(/onnxruntime-web@(\d+\.\d+\.\d+)/g)) {
        urls.push({ file, version: m[1]! });
      }
    }

    // If this fires, either a worker was added without a pinned CDN URL or the
    // pin above moved without the URLs following it.
    expect(urls.length).toBeGreaterThan(0);
    for (const { file, version } of urls) {
      expect(version, `${file} pins the WASM CDN to onnxruntime-web@${version}`).toBe(pinned);
    }
  });

  it('the lockfile resolves onnxruntime-web to the pinned version everywhere we own', () => {
    const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    const ours = Object.entries(lock.packages)
      .filter(([path]) => path.endsWith('node_modules/onnxruntime-web'))
      .filter(([path]) => path !== TRANSFORMERS_NESTED);

    expect(ours.length).toBeGreaterThan(0);
    for (const [path, entry] of ours) {
      expect(entry.version, `${path} resolved to ${entry.version}`).toBe(pinned);
    }
  });
});
