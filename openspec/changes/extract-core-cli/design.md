# Design — extract-core-cli

## 0. Scope and Reading Order

This document locks the interfaces, file layout, and architectural calls for the `extract-core-cli` change. It assumes the proposal (`openspec/changes/extract-core-cli/proposal.md`) is approved and reads it as decided context, not open territory. Open items deliberately deferred to spec/tasks are flagged as such.

Audience: `sdd-tasks` (which generates the implementation checklist) and `sdd-apply` (which writes the code). After this design, no further architectural decisions should be required during implementation — only mechanical execution.

---

## A. Package and Workspace Topology

### A.1 Repo shape after change

```
nukebg/                                  ← repo root, npm workspaces orchestrator
├── package.json                         ← workspaces declaration, root-level dev tools
├── tsconfig.base.json                   ← shared compiler options (NEW)
├── tsconfig.json                        ← root project-references aggregator (NEW)
├── eslint.config.js                     ← unchanged; flat config already covers all packages via rootDir
├── packages/
│   ├── nukebg-core/                     ← NEW: pure library, public on npm
│   │   ├── package.json
│   │   ├── tsconfig.json                ← project reference: extends base, composite=true
│   │   ├── src/                         ← see §C.1
│   │   ├── tests/
│   │   └── dist/                        ← tsc output (committed? no — gitignored)
│   ├── nukebg-cli/                      ← NEW: Node binary, public on npm
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/                         ← see §C.2
│   │   ├── tests/
│   │   └── dist/                        ← tsup output, single ESM bundle + .d.ts
│   └── nukebg-app/                      ← RENAMED from repo root contents
│       ├── package.json                 ← was root package.json (private:true stays)
│       ├── tsconfig.json                ← project reference; depends on nukebg-core
│       ├── vite.config.ts               ← moved from root
│       ├── public/
│       ├── index.html
│       ├── src/                         ← unchanged tree, but imports from `nukebg-core`
│       └── tests/                       ← component + worker-shell tests stay here
├── e2e/                                 ← stays at root (Playwright covers the app)
├── playwright.config.ts                 ← stays at root, points at packages/nukebg-app
├── openspec/                            ← stays at root
└── .github/workflows/                   ← stays at root, expanded matrix per §K
```

Decision: `nukebg-app` is the new home for the existing browser app. Reason: keeping it at the root while introducing `packages/*` produces a hybrid layout that confuses tooling (Vite, ESLint root resolution, Vitest project picking). One consistent convention beats two halves.

### A.2 Root `package.json` (shape)

```json
{
  "name": "nukebg-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "tsc -b && npm run build -ws --if-present",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "dev": "npm run dev -w nukebg-app"
  },
  "devDependencies": {
    "@eslint/js": "...",
    "eslint": "...",
    "eslint-plugin-no-unsanitized": "...",
    "happy-dom": "...",
    "prettier": "...",
    "typescript": "^6.0.3",
    "typescript-eslint": "...",
    "vitest": "^4.1.5",
    "@playwright/test": "..."
  },
  "engines": { "node": ">=20.0.0" }
}
```

Root holds only cross-cutting dev tools (lint, format, vitest workspace runner, playwright). Runtime deps move into the packages that need them.

### A.3 `packages/nukebg-core/package.json`

```json
{
  "name": "nukebg-core",
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "description": "Pure CV+ML pipeline for nukebg — runtime-agnostic background removal, watermark detection, and inpainting.",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {},
  "engines": { "node": ">=20.0.0" }
}
```

Zero runtime deps. ZERO. The whole point of `nukebg-core` is to be a pile of pure functions and interfaces that any runtime can wire.

### A.4 `packages/nukebg-cli/package.json`

```json
{
  "name": "nukebg-cli",
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "description": "CLI for nukebg — Node-only background removal using nukebg-core.",
  "bin": { "nukebg": "./dist/cli.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  },
  "dependencies": {
    "nukebg-core": "0.1.0",
    "@huggingface/transformers": "^3.8.1",
    "onnxruntime-node": "^1.24.0",
    "sharp": "^0.34.5",
    "commander": "^12.1.0",
    "env-paths": "^3.0.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0"
  },
  "engines": { "node": ">=20.0.0" }
}
```

### A.5 `packages/nukebg-app/package.json` (renamed root)

```json
{
  "name": "nukebg-app",
  "private": true,
  "version": "2.12.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "nukebg-core": "0.1.0",
    "@huggingface/transformers": "^3.8.1",
    "onnxruntime-web": "^1.24.3",
    "jszip": "^3.10.1"
  },
  "devDependencies": {
    "vite": "^8.0.10"
  },
  "engines": { "node": ">=20.0.0" }
}
```

The browser app keeps `onnxruntime-web` and `@huggingface/transformers`; the CLI keeps `onnxruntime-node` and the same `@huggingface/transformers` (which supports both ORT flavors via its own conditional resolution). Each package only sees ONE ORT — that is the whole point.

### A.6 TypeScript project references — YES

Decision: use `tsc -b` with project references. Justification: three packages with strict mode and a clear dep order (core → cli, core → app), reference graph guarantees the right build order in CI and incremental rebuilds during dev. Strict-mode `composite: true` also enforces `dist/` separation per package, which makes published artifacts predictable.

Tradeoff acknowledged: project references require `outDir` and `composite` per package, can complicate Vite (which has its own build pipeline). Vite ignores tsc output during dev — it transpiles `.ts` directly — so the references only matter for `npm run typecheck` and CLI publish. Acceptable.

`tsconfig.base.json` (excerpt):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": false,
    "verbatimModuleSyntax": true
  }
}
```

Each package extends this and sets `composite: true`, `outDir: "./dist"`, `rootDir: "./src"`, plus `references: [{ "path": "../nukebg-core" }]` where applicable.

### A.7 Build tooling per package

| Package | Build tool | Output |
|---------|-----------|--------|
| `nukebg-core` | plain `tsc -b` | ESM `.js` + `.d.ts` files mirroring `src/` tree under `dist/` |
| `nukebg-cli` | `tsup` (bundled ESM, single-file `dist/cli.js` shebang `#!/usr/bin/env node`) | one bundled CLI entry + `.d.ts` |
| `nukebg-app` | `vite build` | hashed assets under `dist/` for static hosting |

Why `tsup` for the CLI: bundles dependencies that are CommonJS-only into ESM, produces a clean `bin` artifact with `--shims`, supports `--external onnxruntime-node` so the native `.node` addons don't get bundled (they must remain dynamically resolved).

Why plain `tsc` for core: a library should ship readable per-file output; consumers get tree-shaking from their own bundler. Bundling a library is an anti-pattern that breaks downstream sourcemaps and tree-shaking.

### A.8 Test runner config

Decision: ONE root `vitest.config.ts` using Vitest projects (workspaces) feature. Reason: existing happy-dom env is required for browser tests; core tests are pure Node; CLI tests need Node. One config with three projects keeps `npm test` from the root working as today.

```ts
// vitest.config.ts (root, NEW)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        name: 'core',
        root: './packages/nukebg-core',
        environment: 'node'
      },
      {
        name: 'cli',
        root: './packages/nukebg-cli',
        environment: 'node'
      },
      {
        name: 'app',
        root: './packages/nukebg-app',
        environment: 'happy-dom'
      }
    ]
  }
});
```

Per-package `vitest.config.ts` may exist for `npm test -w <pkg>` ergonomics but the root config is the source of truth.

---

## B. `nukebg-core` Public API

### B.1 Public re-export map (`packages/nukebg-core/src/index.ts`)

```ts
// Types
export type { ImageDataLike } from './types/image-data-like.js';
export type { PipelineMode, PipelinePrecision, PipelineOptions } from './types/pipeline-options.js';
export type { PipelineResult, PipelineStage, StageStatus, StageEvent, ImageContentType } from './types/pipeline-result.js';
export type { BgColorResult, WatermarkResult, ClassifyImageResult, ImageFeatures } from './types/cv-results.js';

// Runner interfaces — the runtime seams
export type { PipelineRunner } from './runners/pipeline-runner.js';
export type { RmbgRunner, RmbgRefineOptions } from './runners/rmbg-runner.js';
export type { LamaRunner } from './runners/lama-runner.js';
export type { ImageCodec, EncodeFormat } from './runners/image-codec.js';

// Top-level orchestrator
export { runPipeline } from './pipeline/run-pipeline.js';
export { PipelineAbortError } from './pipeline/errors.js';

// Pure CV functions — public for advanced consumers, also used by the app's WorkerPipelineRunner
export * as cv from './cv/index.js';

// Constants (read-only)
export {
  CV_PARAMS, WATERMARK_PARAMS, SPARKLE_PARAMS, INPAINT_PARAMS,
  RMBG_PARAMS, LAMA_PARAMS, IMAGE_CLASSIFY_PARAMS,
  PRECISION_PROFILES, EDGE_REFINE_PARAMS, LAMA_ROUTER_PARAMS,
  type PrecisionMode
} from './pipeline/constants.js';
```

### B.2 `ImageDataLike`

```ts
// types/image-data-like.ts
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Optional: present when constructed by the browser ImageData constructor. Core never reads it. */
  readonly colorSpace?: 'srgb' | 'display-p3';
}

/** Construct an ImageDataLike from raw pixels. Use this instead of `new ImageData(...)` in core. */
export function createImageDataLike(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ImageDataLike {
  return { data, width, height };
}
```

Browser `ImageData` is structurally compatible (it has `data: Uint8ClampedArray`, `width`, `height`, plus `colorSpace`). Core never constructs `new ImageData(...)` — it uses `createImageDataLike` which returns a plain frozen-by-convention object.

### B.3 `PipelineRunner`

```ts
// runners/pipeline-runner.ts
import type { ImageDataLike } from '../types/image-data-like.js';
import type { PipelineOptions } from '../types/pipeline-options.js';
import type { PipelineResult } from '../types/pipeline-result.js';

/**
 * Runs the full pipeline on an image. Implementations differ by HOW the
 * stages execute (Worker-backed in browser, inline in Node) but the
 * contract is identical.
 */
export interface PipelineRunner {
  /**
   * Process a single image end-to-end. Resolves with a frozen
   * PipelineResult. Rejects with PipelineAbortError if `options.signal`
   * fires, or with a regular Error on stage failure.
   */
  run(input: ImageDataLike, options?: PipelineOptions): Promise<PipelineResult>;

  /** Pre-load any models eagerly. Optional; runners may no-op. */
  preload?(): Promise<void>;

  /** Release resources (workers, ONNX sessions, file handles). */
  dispose(): Promise<void>;
}
```

### B.4 `RmbgRunner`

```ts
// runners/rmbg-runner.ts
import type { ImageDataLike } from '../types/image-data-like.js';

export interface RmbgRefineOptions {
  readonly spatialPasses: number;
  readonly spatialRadius: number;
  readonly morphOpenRadius: number;
  readonly clusterRatio: number;
  readonly minClusterSize: number;
}

/**
 * Background-removal model runner. Returns an alpha mask (0..255) at the
 * same dimensions as `input`. Implementations: BrowserRmbgRunner
 * (transformers.js + onnxruntime-web in a Worker), OnnxNodeRmbgRunner
 * (transformers.js + onnxruntime-node in-process).
 */
export interface RmbgRunner {
  /** Optional model preload. Throws on integrity failure. */
  load?(opts?: { signal?: AbortSignal }): Promise<void>;

  /**
   * Run segmentation. Resolves with a Uint8Array of length width*height.
   * Threshold and refine options match the existing RMBG worker contract.
   */
  segment(
    input: ImageDataLike,
    opts: {
      threshold: number;
      refine: RmbgRefineOptions;
      signal?: AbortSignal;
      onProgress?: (pct: number) => void;
    }
  ): Promise<Uint8Array>;

  dispose(): Promise<void>;
}
```

### B.5 `LamaRunner`

```ts
// runners/lama-runner.ts
import type { ImageDataLike } from '../types/image-data-like.js';

/**
 * LaMa ONNX inpainting runner. Takes RGBA pixels + a binary mask
 * (0=keep, 1=inpaint) and returns RGBA pixels with the masked region
 * reconstructed. Same dimensions on input and output.
 */
export interface LamaRunner {
  load?(opts?: { signal?: AbortSignal }): Promise<void>;

  inpaint(
    input: ImageDataLike,
    mask: Uint8Array,
    opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
  ): Promise<Uint8ClampedArray>;

  dispose(): Promise<void>;
}
```

### B.6 `ImageCodec`

```ts
// runners/image-codec.ts
import type { ImageDataLike } from '../types/image-data-like.js';

export type EncodeFormat = 'png' | 'webp';

/**
 * I/O boundary. Decode bytes into pixels; encode pixels into bytes.
 * Browser implementation uses createImageBitmap+OffscreenCanvas.
 * Node implementation uses sharp.
 */
export interface ImageCodec {
  /**
   * Decode a buffer into RGBA pixels. The codec MAY downscale to
   * `maxDimension` when provided; if it does, it MUST report the
   * original dimensions.
   */
  decode(
    bytes: Uint8Array | ArrayBufferView,
    opts?: { maxDimension?: number }
  ): Promise<{
    image: ImageDataLike;
    originalWidth: number;
    originalHeight: number;
    wasDownsampled: boolean;
  }>;

  encode(
    image: ImageDataLike,
    format: EncodeFormat,
    opts?: { quality?: number }
  ): Promise<Uint8Array>;
}
```

### B.7 `PipelineOptions` / `PipelineResult`

```ts
// types/pipeline-options.ts
export type PipelineMode = 'photo' | 'signature' | 'icon' | 'auto';
export type PipelinePrecision = 'low' | 'normal' | 'high' | 'ultra';

export interface PipelineOptions {
  /** Default 'auto' (let the classifier decide) */
  readonly mode?: PipelineMode;
  /** Default 'normal' */
  readonly precision?: PipelinePrecision;
  /** Skip watermark detection + inpainting. Default false. */
  readonly skipWatermark?: boolean;
  /** Cancellation. */
  readonly signal?: AbortSignal;
  /** Stage event sink. Optional. */
  readonly onStage?: (event: StageEvent) => void;
}

// types/pipeline-result.ts — moved from src/types/pipeline.ts
//   Same shape EXCEPT `imageData: ImageData` becomes `imageData: ImageDataLike`.
//   Browser ImageData satisfies ImageDataLike, so existing browser callers don't break.
```

### B.8 Error semantics

All runners follow these rules:
- Cancellation via `AbortSignal` MUST reject with `PipelineAbortError` (re-exported from core).
- Network/integrity failures during model load MUST reject with a regular `Error` whose message includes the model id and the reason (`"RMBG-1.4 hash mismatch: got X, expected Y"`).
- Stage timeouts are NOT a runner concern in core — the runtime adapter (browser orchestrator or CLI) wraps calls with timeouts.

---

## C. Module-Level File Layout

### C.1 `packages/nukebg-core/src/`

```
packages/nukebg-core/src/
├── index.ts                                  — public re-exports (§B.1)
├── types/
│   ├── image-data-like.ts                    — ImageDataLike, createImageDataLike
│   ├── pipeline-options.ts                   — PipelineMode, PipelinePrecision, PipelineOptions
│   ├── pipeline-result.ts                    — PipelineResult, PipelineStage, StageStatus, StageEvent, ImageContentType
│   └── cv-results.ts                         — BgColorResult, WatermarkResult, ClassifyImageResult, ImageFeatures, GridResult
├── runners/
│   ├── pipeline-runner.ts                    — interface
│   ├── rmbg-runner.ts                        — interface + RmbgRefineOptions
│   ├── lama-runner.ts                        — interface
│   └── image-codec.ts                        — interface + EncodeFormat
├── pipeline/
│   ├── run-pipeline.ts                       — runtime-agnostic orchestrator (§D)
│   ├── errors.ts                             — PipelineAbortError
│   ├── finalize.ts                           — moved from src/pipeline/finalize.ts, ImageData→ImageDataLike
│   ├── finalize-result.ts                    — moved, ImageData→ImageDataLike
│   ├── final-composite.ts                    — moved from src/utils/final-composite.ts
│   ├── auto-crop.ts                          — moved from src/utils/auto-crop.ts
│   └── constants.ts                          — moved from src/pipeline/constants.ts (unchanged)
├── cv/
│   ├── index.ts                              — barrel for `cv.*` namespace export
│   ├── alpha-matting.ts                      — moved
│   ├── alpha-refine.ts                       — moved
│   ├── classify-image.ts                     — moved
│   ├── clamp.ts                              — moved
│   ├── detect-bg-colors.ts                   — moved
│   ├── detect-checker-grid.ts                — moved
│   ├── foreground-estimation.ts              — moved
│   ├── grid-flood-fill.ts                    — moved
│   ├── inpaint-blend.ts                      — moved
│   ├── inpaint-telea.ts                      — moved
│   ├── lama-crop.ts                          — moved
│   ├── lama-router.ts                        — moved
│   ├── patchmatch-inpaint.ts                 — moved
│   ├── shadow-cleanup.ts                     — moved
│   ├── signature-threshold.ts                — moved
│   ├── simple-flood-fill.ts                  — moved
│   ├── sparkle-detect.ts                     — moved
│   ├── subject-exclusion.ts                  — moved
│   ├── utils.ts                              — moved
│   ├── watermark-dalle.ts                    — moved
│   └── watermark-detect.ts                   — moved
└── inpaint/
    └── patch-match.ts                        — extracted PURE inner from src/workers/inpaint.worker.ts (the `patchMatchInpaint` function only)
```

Test mirror under `packages/nukebg-core/tests/` follows the same tree, importing from `../src/...`. Tests for CV, finalize, auto-crop, final-composite, classify, watermark, etc. move from `tests/cv/`, `tests/workers/cv/`, `tests/utils/` into here unchanged except for the import path swap.

### C.2 `packages/nukebg-cli/src/`

```
packages/nukebg-cli/src/
├── index.ts                                  — re-exports the Node runners + factory for programmatic use
├── cli.ts                                    — bin entry: shebang, commander setup, dispatch
├── commands/
│   ├── process.ts                            — `nukebg <input>` default command
│   └── license.ts                            — `nukebg license` / `--revoke`
├── runners/
│   ├── node-pipeline-runner.ts               — implements PipelineRunner inline (no Workers)
│   ├── onnx-node-rmbg.ts                     — implements RmbgRunner via @huggingface/transformers Node + onnxruntime-node
│   └── onnx-node-lama.ts                     — implements LamaRunner via onnxruntime-node directly
├── codecs/
│   └── sharp-codec.ts                        — implements ImageCodec via sharp
├── license/
│   ├── gate.ts                               — assertAccepted(), accept(), revoke(), state()
│   └── marker.ts                             — JSON schema, read/write to env-paths config dir
├── reporting/
│   ├── progress-tty.ts                       — human-readable progress (stderr)
│   └── progress-json.ts                      — line-delimited JSON events (stdout when --json)
├── util/
│   ├── exit-codes.ts                         — frozen ExitCode enum (§H.2)
│   ├── errors.ts                             — Error → exit code mapping
│   └── version.ts                            — read package.json version at build time via tsup banner
└── tests/
    ├── fixtures/                             — small PNG/JPEG inputs
    ├── runners/...
    ├── license/gate.test.ts
    └── codecs/sharp-codec.test.ts
```

---

## D. `runPipeline` Algorithm

### D.1 Pseudocode

```ts
// packages/nukebg-core/src/pipeline/run-pipeline.ts

import type { ImageDataLike } from '../types/image-data-like.js';
import type { PipelineOptions } from '../types/pipeline-options.js';
import type { PipelineResult } from '../types/pipeline-result.js';
import type { RmbgRunner } from '../runners/rmbg-runner.js';
import type { LamaRunner } from '../runners/lama-runner.js';
import { classifyImage } from '../cv/classify-image.js';
import { detectBgColors } from '../cv/detect-bg-colors.js';
import { watermarkDetect } from '../cv/watermark-detect.js';
import { watermarkDetectDalle } from '../cv/watermark-dalle.js';
import { sparkleDetect } from '../cv/sparkle-detect.js';
import { signatureThreshold } from '../cv/signature-threshold.js';
import { compositeWithFeather, dilateMask } from '../cv/inpaint-blend.js';
import { shouldUseLama } from '../cv/lama-router.js';
import { patchMatchInpaint } from '../inpaint/patch-match.js';
import { PRECISION_PROFILES, INPAINT_PARAMS, IMAGE_CLASSIFY_PARAMS } from './constants.js';
import { PipelineAbortError } from './errors.js';

export interface RunnerBundle {
  readonly rmbg: RmbgRunner;
  /** Optional — when omitted, the LaMa branch falls back to PatchMatch. */
  readonly lama?: LamaRunner;
}

export async function runPipeline(
  input: ImageDataLike,
  runners: RunnerBundle,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const { mode = 'auto', precision = 'normal', skipWatermark = false, signal, onStage } = options;
  const emit = (stage, status, message) => onStage?.({ stage, status, message });
  const checkAbort = () => { if (signal?.aborted) throw new PipelineAbortError('aborted'); };

  const start = performance.now();
  const stageTiming: Partial<Record<PipelineStage, number>> = {};
  const { width, height } = input;
  const originalPixels = new Uint8ClampedArray(input.data);

  // ── Stage 1: classify + bg detect (CV, parallel) ──
  emit('detect-background', 'running', 'Analyzing image...');
  const t1 = performance.now();
  const [bgInfo, classifyResult] = await Promise.all([
    detectBgColors(originalPixels, width, height),
    classifyImage(originalPixels, width, height),
  ]);
  checkAbort();
  const contentType = mode === 'auto' ? classifyResult.type : modeToContentType(mode);
  stageTiming['detect-background'] = performance.now() - t1;
  emit('detect-background', 'done', `${contentType.toLowerCase()} detected`);

  // ── SIGNATURE shortcut: skip ML ──
  if (contentType === 'SIGNATURE') {
    emit('watermark-scan', 'skipped');
    emit('inpaint', 'skipped');
    emit('ml-segmentation', 'running', 'Extracting signature...');
    const t2 = performance.now();
    const sigAlpha = signatureThreshold(originalPixels, width, height);
    stageTiming['ml-segmentation'] = performance.now() - t2;
    emit('ml-segmentation', 'done', 'Signature extracted');
    return composeResult(originalPixels, sigAlpha, width, height, contentType, false, null, start, stageTiming);
  }

  // ── Stage 2 + 3: watermark detect + inpaint (skip for ICON or skipWatermark) ──
  let watermarkRemoved = false;
  let appliedWatermarkMask: Uint8Array | null = null;

  if (contentType !== 'ICON' && !skipWatermark) {
    emit('watermark-scan', 'running', 'Checking for watermarks...');
    const t2 = performance.now();
    const [wmGemini, wmDalle, wmSparkle] = await Promise.all([
      watermarkDetect(originalPixels, width, height, bgInfo.colorA, bgInfo.colorB),
      watermarkDetectDalle(originalPixels, width, height),
      sparkleDetect(originalPixels, width, height),
    ]);
    checkAbort();

    // Same gating logic as today: gemini confirmed by sparkle, OR dalle, OR sparkle alone.
    const geminiConfirmed = wmGemini.detected && wmSparkle.detected;
    const geminiMaskGated = geminiConfirmed ? wmGemini.mask : null;
    const anyWatermark = geminiConfirmed || wmDalle.detected || wmSparkle.detected;
    const combinedMask = combineMasks([geminiMaskGated, wmDalle.mask, wmSparkle.mask], width * height);

    if (anyWatermark && combinedMask) {
      stageTiming['watermark-scan'] = performance.now() - t2;
      emit('watermark-scan', 'done', `Watermark detected`);

      const t3 = performance.now();
      const router = shouldUseLama(originalPixels, width, height, combinedMask);
      const dilated = dilateMask(combinedMask, width, height, INPAINT_PARAMS.FEATHER_RADIUS);
      let inpainted: Uint8ClampedArray;

      if (router.useLama && runners.lama) {
        emit('inpaint', 'running', 'Reconstructing zone [AI]...');
        try {
          inpainted = await runners.lama.inpaint(
            { data: originalPixels, width, height },
            dilated,
            { signal }
          );
        } finally {
          await runners.lama.dispose();
        }
      } else {
        emit('inpaint', 'running', 'Reconstructing watermark area...');
        inpainted = patchMatchInpaint(originalPixels, width, height, dilated);
      }
      checkAbort();

      const blended = compositeWithFeather(originalPixels, inpainted, combinedMask, width, height, {
        featherRadius: INPAINT_PARAMS.FEATHER_RADIUS,
        noiseSigma: INPAINT_PARAMS.NOISE_SIGMA,
      });
      originalPixels.set(blended);
      watermarkRemoved = true;
      appliedWatermarkMask = combinedMask;
      stageTiming['inpaint'] = performance.now() - t3;
      emit('inpaint', 'done', router.useLama ? 'Zone reconstructed [AI]' : 'Watermark reconstructed');
    } else {
      emit('watermark-scan', 'done', 'No watermarks found');
      emit('inpaint', 'skipped');
      stageTiming['watermark-scan'] = performance.now() - t2;
    }
  } else {
    emit('watermark-scan', 'skipped');
    emit('inpaint', 'skipped');
  }

  // ── Stage 4: RMBG segmentation ──
  emit('ml-segmentation', 'running', 'Loading background removal model...');
  const t4 = performance.now();
  const profile = PRECISION_PROFILES[precision];
  const threshold = contentType === 'ICON' ? IMAGE_CLASSIFY_PARAMS.ICON_RMBG_THRESHOLD : profile.rmbgThreshold;
  const mlAlpha = await runners.rmbg.segment(
    { data: originalPixels, width, height },
    {
      threshold,
      refine: {
        spatialPasses: profile.spatialPasses,
        spatialRadius: profile.spatialRadius,
        morphOpenRadius: profile.morphOpenRadius,
        clusterRatio: profile.clusterRatio,
        minClusterSize: profile.minClusterSize,
      },
      signal,
      onProgress: (pct) => emit('ml-segmentation', 'running', `Loading AI model... ${pct}%`),
    }
  );
  stageTiming['ml-segmentation'] = performance.now() - t4;
  emit('ml-segmentation', 'done', 'Background removed');

  return composeResult(originalPixels, mlAlpha, width, height, contentType, watermarkRemoved, appliedWatermarkMask, start, stageTiming);
}
```

`composeResult`, `combineMasks`, `modeToContentType` are private helpers in the same file — they mirror today's `PipelineOrchestrator.composeResult` / `combineMasks` minus the `new ImageData(...)` call (replaced with `createImageDataLike(...)`).

### D.2 Sequence diagram (CLI invocation)

```
CLI: nukebg main.png -o out.png
   │
   ├─► commander.parse → ProcessCommand.execute
   │
   ├─► licenseGate.assertAccepted()                ← throws if not accepted
   │
   ├─► SharpImageCodec.decode(fs.readFile('main.png'))
   │       └─► sharp().raw().ensureAlpha().toBuffer()
   │       └─► returns { image: { data, width, height }, originalWidth, originalHeight, wasDownsampled }
   │
   ├─► OnnxNodeRmbgRunner.load() (eager)            ← downloads/caches RMBG-1.4
   │
   ├─► runPipeline(image, { rmbg, lama }, opts)
   │       ├─► detectBgColors + classifyImage  (parallel, pure CV)
   │       ├─► [if PHOTO] watermarkDetect/Dalle/Sparkle  (parallel, pure CV)
   │       ├─► [if watermark] router → OnnxNodeLamaRunner.inpaint OR patchMatchInpaint
   │       ├─► [if !SIGNATURE] OnnxNodeRmbgRunner.segment(image, opts)
   │       │       └─► transformers.pipeline(...)({ image }, { ... })
   │       └─► composeResult → returns PipelineResult
   │
   ├─► [optional] finalize.refineEdges + autoCropToSubject (pure CV)
   │
   ├─► SharpImageCodec.encode(result.imageData, 'png')
   │       └─► sharp(rawBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer()
   │
   └─► fs.writeFile('out.png', encoded) → exit(0)
```

---

## E. Browser-Side Adapter

The existing app under `packages/nukebg-app/` keeps Workers, but reshapes its top-level orchestrator to implement `PipelineRunner` from core.

### E.1 Today vs tomorrow

```ts
// today: src/pipeline/orchestrator.ts
class PipelineOrchestrator implements ImageProcessor {
  process(imageData: ImageData, modelId?, precision?, signal?): Promise<PipelineResult>;
}

// tomorrow: packages/nukebg-app/src/pipeline/worker-pipeline-runner.ts
class WorkerPipelineRunner implements PipelineRunner {
  run(input: ImageDataLike, options?: PipelineOptions): Promise<PipelineResult>;
  async preload(): Promise<void> { /* load-model on ml channel */ }
  async dispose(): Promise<void> { /* tear down all 4 channels */ }
}
```

### E.2 Diff shape per file

| File | Action |
|------|--------|
| `packages/nukebg-app/src/pipeline/orchestrator.ts` | RENAME to `worker-pipeline-runner.ts`. Class renamed `WorkerPipelineRunner`. Implements `PipelineRunner`. `process()` becomes `run()`. `ImageData` parameter becomes `ImageDataLike`. Signature extras (`modelId`, `precision`) move into `PipelineOptions`. |
| `packages/nukebg-app/src/pipeline/image-processor.ts` | DELETE. The new contract is `PipelineRunner` from core. Components that depended on `ImageProcessor` get retyped to `PipelineRunner`. |
| `packages/nukebg-app/src/pipeline/worker-channel.ts` | UNCHANGED. Still browser-only. |
| `packages/nukebg-app/src/workers/*.ts` | UNCHANGED in code. Imports of `pipeline/constants` and `cv/*` change to `nukebg-core` package imports. |
| `packages/nukebg-app/src/utils/image-io.ts` | UNCHANGED. Browser-only. Could later be wrapped as a `BrowserImageCodec implements ImageCodec`, but not in v1. |
| `packages/nukebg-app/src/components/ar-*.ts` | Minor: any direct construction of `PipelineOrchestrator` becomes `WorkerPipelineRunner`. Method calls `process(...)` → `run(...)`. Parameters reshaped per `PipelineOptions`. Estimate ~10 spots; surgical. |
| `packages/nukebg-app/src/pipeline/finalize.ts` and `src/utils/final-composite.ts`, `src/utils/auto-crop.ts` | DELETE (moved to core). All imports retargeted to `nukebg-core`. |

The browser app keeps `ImageData` as its in-memory pixel container — `ImageData` is structurally `ImageDataLike`, so callers don't need to change their value construction. Only the type annotations on shared APIs change.

### E.3 Worker wiring inside `WorkerPipelineRunner`

`WorkerPipelineRunner.run` is essentially the body of today's `_process(...)`. It does NOT call `runPipeline()` from core because the browser path interleaves Worker calls (cv-worker for `detectBgColors`, ml-worker for segment, lama-worker for inpaint) — the pure-CV core implementations live inside the browser's CV Worker, not on the main thread. Calling `runPipeline()` from main thread would move all CV onto the main thread, which is the OPPOSITE of what we want.

So: the browser `WorkerPipelineRunner` keeps its current postMessage flow. It implements the SAME contract as `runPipeline`, not the same code. The CV worker bundle, on the other hand, imports `nukebg-core/cv` for the pure implementations.

This is a deliberate architectural call (see ADR-3): the browser keeps its Worker fan-out, the CLI gets a different inline runner that DOES call `runPipeline` directly. Both satisfy `PipelineRunner`; they reach the same result.

---

## F. ImageDataLike Migration Plan

Seven `new ImageData(...)` call sites identified in exploration. Each becomes a plain `{ data, width, height }` object (or via `createImageDataLike(...)` helper).

| # | File (current) | Line | Current code | New code | Test |
|---|---------------|------|--------------|----------|------|
| 1 | `src/pipeline/finalize.ts` | 250 | `return new ImageData(out, width, height);` (in `fillSubjectHoles`) | `return createImageDataLike(out, width, height);` | Existing `tests/utils/finalize.test.ts` (move to core) — type-only change, asserts on `.data`/`.width`/`.height` already. |
| 2 | `src/pipeline/finalize.ts` | 335 | `return new ImageData(out, width, height);` (in `dropOrphanBlobs`) | same as #1 | Same test file. |
| 3 | `src/pipeline/finalize.ts` | 391 | `return new ImageData(out, width, height);` (in `promoteSpeckleAlpha`) | same | Same. |
| 4 | `src/pipeline/finalize.ts` | 574 | `return new ImageData(new Uint8ClampedArray(rgba), w, h);` (in `refineEdges`) | `return createImageDataLike(new Uint8ClampedArray(rgba), w, h);` | Same. |
| 5 | `src/utils/final-composite.ts` | 202 | `new ImageData(...)` | `createImageDataLike(...)` | `tests/utils/final-composite.test.ts` — already polyfills `ImageData`; the polyfill can be DELETED in core because tests construct plain objects. |
| 6 | `src/utils/final-composite.ts` | 254 | same | same | same |
| 7 | `src/utils/auto-crop.ts` | 73 | `return new ImageData(out, cw, ch);` | `return createImageDataLike(out, cw, ch);` | `tests/utils/auto-crop.test.ts` (move to core) |
| 8 | `src/pipeline/orchestrator.ts` | 592 | `new ImageData(resultPixels, width, height)` | DELETE — the new `composeResult` in core returns `createImageDataLike(...)` instead. The browser `WorkerPipelineRunner` builds its own `ImageData` only when its result passes back to a Canvas-bound consumer (rare; most callers consume `workingPixels` + alpha and re-pack). |

The browser side is unaffected: `ImageData` already satisfies `ImageDataLike`, so any browser code that still constructs `new ImageData` keeps working. We only enforce `ImageDataLike` consumption inside core.

---

## G. License Gate Mechanics

### G.1 Config dir resolution

Use `env-paths` package. Reason: hand-rolling `os.homedir()` + platform switch is tractable but `env-paths` is a tiny zero-dep package (10 lines of source) that already implements the XDG Base Directory spec on Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows. Reinventing this is pure overhead.

```ts
// packages/nukebg-cli/src/license/marker.ts
import envPaths from 'env-paths';
const paths = envPaths('nukebg', { suffix: '' });
// paths.config = e.g. /home/user/.config/nukebg or /Users/user/Library/Preferences/nukebg
const MARKER_PATH = path.join(paths.config, 'accepted-license.json');
```

### G.2 Marker schema

```ts
// packages/nukebg-cli/src/license/marker.ts
export interface LicenseMarker {
  /** Schema version. Bump when format changes. v1 = current. */
  readonly version: 1;
  /** ISO 8601 timestamp of acceptance. */
  readonly acceptedAt: string;
  /** Free-form acknowledgement string for human verification. */
  readonly acknowledged: 'RMBG-1.4 CC-BY-NC-4.0';
  /** CLI version that wrote the marker, for diagnostics. */
  readonly cliVersion: string;
}
```

Read returns `LicenseMarker | null`. Write atomically via `fs.writeFile(path + '.tmp', ...)` then `fs.rename` to avoid torn writes.

### G.3 Interactive prompt

Use `node:readline/promises`. Reason: native, zero install cost, handles Ctrl+C cleanly. `@inquirer/confirm` pulls in the entire `@inquirer` toolkit (~100KB). Overkill for one yes/no prompt.

```ts
import { createInterface } from 'node:readline/promises';
const rl = createInterface({ input: process.stdin, output: process.stderr });
const answer = await rl.question('Accept non-commercial use? [y/N] ');
rl.close();
return answer.trim().toLowerCase() === 'y';
```

Prompts go to **stderr** so `--json` mode on stdout stays clean.

### G.4 Non-TTY detection

```ts
const isInteractive = process.stdin.isTTY && process.stderr.isTTY;
```

Edge cases documented:
- `nukebg main.png < /dev/null`: stdin is not TTY → cannot prompt → exit code 78 (`LICENSE_REQUIRED`) with message instructing `--accept-non-commercial`.
- `nukebg main.png 2>err.log`: stderr is not TTY → same. Forces explicit acceptance for any redirected setup.
- `--accept-non-commercial`: bypasses the prompt entirely, writes the marker, proceeds. Documented as the canonical CI flag.
- `--quiet --accept-non-commercial`: writes marker, no banner. Documented for fully silent CI.

### G.5 Gate state machine

```
START
  │
  ▼
[read marker]
  ├─ valid marker exists ──────────────► PROCEED
  │
  ├─ no marker, --accept-non-commercial ► WRITE MARKER → PROCEED
  │
  ├─ no marker, interactive TTY ──────► PROMPT
  │       ├─ y ─► WRITE MARKER → PROCEED
  │       └─ N ─► EXIT 78 "License declined"
  │
  └─ no marker, non-TTY, no flag ──────► EXIT 78 "License required, use --accept-non-commercial"
```

`nukebg license` subcommand prints status. `nukebg license --revoke` deletes the marker.

---

## H. CLI Entrypoint Wiring

### H.1 Argparser

Use **`commander`** v12. Reason:
- De-facto Node CLI standard, most users already know its `--help` output style.
- Built-in subcommand support (`nukebg license` is trivial to wire).
- Bundle size with tsup tree-shaking is ~30KB, acceptable for a binary that depends on sharp + ORT (multi-MB).
- TypeScript types are first-class; option parsing returns typed objects via `OptionValues`.

Rejected: `cac` is leaner (~10KB) but lacks subcommand niceties. Rolling our own parser is ~80 lines of careful work for zero benefit when commander exists. `yargs` is heavier than commander with no upside.

### H.2 Exit code table — LOCKED

```ts
// packages/nukebg-cli/src/util/exit-codes.ts
export const ExitCode = Object.freeze({
  OK: 0,
  USER_ERROR: 64,           // bad CLI args, invalid input path, malformed flag
  INPUT_DECODE_FAILED: 65,  // sharp could not decode (corrupt/unsupported file)
  PIPELINE_FAILED: 70,      // CV/ML stage threw a non-recoverable error
  MODEL_DOWNLOAD_FAILED: 74,// network/integrity failure on RMBG or LaMa load
  IO_ERROR: 75,             // fs read/write failure (permission denied, ENOSPC)
  LICENSE_REQUIRED: 78,     // CC-BY-NC-4.0 not accepted
  ABORTED: 130,             // SIGINT (Ctrl+C); matches POSIX convention 128 + signal 2
});
```

These follow `sysexits.h` conventions where they fit (64 EX_USAGE, 65 EX_DATAERR, 70 EX_SOFTWARE, 74 EX_IOERR, 75 EX_TEMPFAIL, 78 EX_CONFIG). `0` and `130` are POSIX-standard.

### H.3 Error → exit code mapping

```ts
// packages/nukebg-cli/src/util/errors.ts
export function exitCodeFor(err: unknown): number {
  if (err instanceof PipelineAbortError) return ExitCode.ABORTED;
  if (err instanceof commander.CommanderError) return ExitCode.USER_ERROR;
  if (err instanceof LicenseRequiredError) return ExitCode.LICENSE_REQUIRED;
  if (err instanceof ImageDecodeError) return ExitCode.INPUT_DECODE_FAILED;
  if (err instanceof ModelLoadError) return ExitCode.MODEL_DOWNLOAD_FAILED;
  if (err instanceof IoError) return ExitCode.IO_ERROR;
  return ExitCode.PIPELINE_FAILED;
}
```

Each `*Error` is a named class extending `Error`. Pipeline runners throw plain `Error`; only the CLI layer translates.

### H.4 `--json` event shape

Line-delimited JSON to stdout (one JSON object per line, newline-terminated). Stable schema:

```ts
type JsonEvent =
  | { type: 'stage-start'; stage: PipelineStage; ts: number }
  | { type: 'stage-progress'; stage: PipelineStage; pct: number; ts: number }
  | { type: 'stage-done'; stage: PipelineStage; ts: number; durationMs: number }
  | { type: 'stage-skipped'; stage: PipelineStage; ts: number }
  | { type: 'license-required'; message: string }
  | { type: 'result'; output: string; format: 'png' | 'webp'; nukedPct: number; totalTimeMs: number; contentType: ImageContentType; watermarkRemoved: boolean };
```

In `--json` mode:
- stdout = newline-delimited events (this stream).
- stderr = nothing (errors go to a final `{ type: 'error', code: number, message: string }` event before exit).
- Output image goes to the `--output` path (NEVER stdout in `--json` mode — they would collide).

In default mode:
- stdout = nothing unless `-o -` (stdout streaming, see below).
- stderr = human progress, errors.
- output image goes to `--output`.

### H.5 Stdin/stdout streaming

**Decision: defer to v1.1.** Reasons:
- `--output -` would force the result format to be inferred (we can pick `--format` to disambiguate, but the contract gets hairy with `--json` already on stdout).
- Stdin `-` requires buffering the full input before sharp can decode (sharp accepts a Buffer; streaming PNG decode is non-trivial). The bytes count of a typical input image (1-20MB) easily fits in memory, but the contract documentation balloons.
- Adding both later is purely additive. Keeping v1 file-only protects the schema.

V1 supports file paths only for `<input>` and `--output`. Documented.

### H.6 Final CLI option set

Lock the proposal's sketch:

```
nukebg <input>
  -o, --output <path>           default: <stem>.nukebg.<format>
  -f, --format <png|webp>       default: png
  --mode <photo|signature|icon|auto>   default: auto
  --precision <low|normal|high|ultra>  default: normal
  --no-watermark                skip detection + inpainting
  --cache-dir <path>            override model cache (default: env TRANSFORMERS_CACHE or env-paths cache)
  --accept-non-commercial       acknowledge RMBG-1.4 CC-BY-NC-4.0
  --json                        emit line-delimited JSON events on stdout
  -q, --quiet                   suppress non-error stderr
  -v, --verbose                 extra timings on stderr
  -h, --help
  --version

nukebg license [--revoke]
nukebg --help
```

**Default output filename**: `<stem>.nukebg.<format>`. Picked over `<stem>-nobg.png` because it matches the project name and the existing browser app's download default — avoids two conventions. (Resolves proposal open question §1.)

---

## I. Model Loading Strategy (Node)

### I.1 RMBG-1.4 via `@huggingface/transformers` (Node mode)

- Package version: `@huggingface/transformers` `^3.8.1` (already in repo). v3 is the Node-supporting line; v2 was browser-only.
- API call:

```ts
import { pipeline, env, RawImage } from '@huggingface/transformers';

env.cacheDir = resolveCacheDir();          // see below
env.allowLocalModels = false;              // force HF Hub fetch (still cached)
env.allowRemoteModels = true;
env.useBrowserCache = false;               // Node mode

const segmenter = await pipeline(
  'image-segmentation',
  'briaai/RMBG-1.4',
  {
    dtype: 'q8',
    revision: RMBG_PARAMS.REVISION,
    device: 'cpu',                         // force CPU; GPU = future work
    progress_callback: (progress) => onProgress(Math.round(progress.progress ?? 0)),
  }
);

const raw = new RawImage(input.data, input.width, input.height, 4);
const [result] = await segmenter(raw, { /* same params today's worker uses */ });
const alpha = result.mask.data;            // Uint8Array, width*height
```

- Cache dir resolution priority:
  1. `--cache-dir` flag.
  2. `process.env.TRANSFORMERS_CACHE` (matches Python convention; lets users share with `transformers` Python).
  3. `process.env.HF_HOME` (fallback, also Python convention).
  4. `env-paths('nukebg').cache` (e.g. `~/.cache/nukebg`).

### I.2 LaMa via `onnxruntime-node` directly

- Package version: `onnxruntime-node` `^1.24.0` (matches the `onnxruntime-web@1.24.3` dev floor for tensor-format compatibility).
- Acquisition: HuggingFace fetch matching the existing browser path (`LAMA_PARAMS.MODEL_URL`), cached on disk.
- Load:

```ts
import * as ort from 'onnxruntime-node';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function loadLama(cacheDir: string): Promise<ort.InferenceSession> {
  const cachePath = join(cacheDir, 'lama-fp32.onnx');
  let buffer: Uint8Array;
  try {
    buffer = await readFile(cachePath);
  } catch {
    const resp = await fetch(LAMA_PARAMS.MODEL_URL);
    if (!resp.ok) throw new ModelLoadError(`fetch lama: HTTP ${resp.status}`);
    buffer = new Uint8Array(await resp.arrayBuffer());
    if (buffer.byteLength !== LAMA_PARAMS.EXPECTED_SIZE) {
      throw new ModelLoadError(`lama size mismatch: ${buffer.byteLength} vs ${LAMA_PARAMS.EXPECTED_SIZE}`);
    }
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, buffer);
  }

  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== LAMA_PARAMS.EXPECTED_SHA256) {
    throw new ModelLoadError(`lama hash mismatch: ${digest} vs ${LAMA_PARAMS.EXPECTED_SHA256}`);
  }

  return await ort.InferenceSession.create(buffer, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  });
}
```

- Tensor pre/post-processing (`rgbaToImageTensor`, `maskToTensor`, `tensorToRgba`) MOVES into core under `packages/nukebg-core/src/cv/lama-tensors.ts` because the math is identical browser/Node — only the `ort.Tensor` constructor differs by package. The runner-side wraps with the right `ort` reference.

Wait — `ort.Tensor` IS runtime-specific. Resolution: keep tensor builders in the **runner**, not core. Core ships the pure pre-processing (resize, crop) via existing `lama-crop.ts`. `OnnxNodeLamaRunner` does the `Float32Array` packing + ORT Tensor construction itself; `BrowserLamaRunner` (the worker) does the same with `onnxruntime-web`'s ORT. ~30 lines of duplicated tensor packing per package; acceptable given the ORT split.

### I.3 SHA-256 integrity check (Node)

```ts
import { createHash } from 'node:crypto';
const digest = createHash('sha256').update(buffer).digest('hex');
```

Hex-encoded, lowercase. Matches the browser's `crypto.subtle.digest('SHA-256', buffer)` + manual hex conversion at `lama.worker.ts:105`. The constants in `nukebg-core/pipeline/constants.ts` (`LAMA_PARAMS.EXPECTED_SHA256`, `RMBG_PARAMS.EXPECTED_SHA256`) are reused verbatim across runtimes.

For RMBG via `@huggingface/transformers`, the integrity check happens AFTER `transformers.pipeline(...)` resolves (the cache is now on disk). Walk the cache dir, find the `model.onnx` (or `model_quantized.onnx`), hash it. If the path resolution proves brittle across transformers.js versions, the v1 fallback is to skip integrity check in Node and document the gap; we have the SHA pinned in core so it can be added back when transformers.js exposes the cache file path API.

---

## J. Test Strategy

### J.1 Tests that move to `packages/nukebg-core/tests/`

Mechanical move + import-path rewrite. No logic changes:

- `tests/cv/**/*.test.ts` — all CV algorithm tests.
- `tests/workers/cv/**/*.test.ts` — same, the file path is just a current-tree quirk.
- `tests/utils/auto-crop.test.ts`
- `tests/utils/final-composite.test.ts` (DROP the `ImageData` polyfill — tests construct plain objects).
- `tests/utils/finalize.test.ts` (if it exists; otherwise the finalize tests live alongside).
- `tests/pipeline/orchestrator.test.ts` — partial: split into `tests/pipeline/run-pipeline.test.ts` (in core, exercises `runPipeline` with mock runners) and `tests/pipeline/worker-pipeline-runner.test.ts` (in app, exercises the Worker-mocked path). The current orchestrator test already mocks the Worker boundary, so the split is just relabeling.
- `tests/utils/image-io.test.ts` — STAYS in app (tests browser-specific magic-byte sniffing). New CLI gets `tests/codecs/sharp-codec.test.ts` for the sharp round-trip.

### J.2 New tests required (list for sd... [truncated]
Session: manual-save-nukebg
Project: nukebg
Scope: project
Topic: sdd/extract-core-cli/design
Duplicates: 1
Revisions: 1
Created: 2026-05-09 21:34:57