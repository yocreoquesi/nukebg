# Tasks — extract-core-cli

> Strict TDD is ACTIVE. Test runner: `npm test`. Every non-mechanical implementation task follows red → green → refactor. Mechanical file moves bring their co-located tests along and expect the suite to stay green after each move.
>
> Exit codes used by the CLI are the sysexits-aligned set from design §H.2 (not the simplified 0–5 set that appears in the spec; the design wins per the mission brief).

---

## Phase 1 — Workspace & Tooling Foundation

_Goal: valid npm workspaces shell with three empty packages. Existing `src/` app still works. Zero behavioral change._

- [x] 1.1 Create `tsconfig.base.json` at repo root with the compiler options from design §A.6 (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `skipLibCheck: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`).

- [x] 1.2 Replace root `tsconfig.json` with a project-references aggregator that extends `tsconfig.base.json` and will gain `references` entries as packages are created. Keep all existing include paths for now so current tests continue to resolve.

- [x] 1.3 Create `packages/nukebg-core/` directory skeleton:
  - `packages/nukebg-core/package.json` — shape from design §A.3: `name: "nukebg-core"`, `version: "0.1.0"`, `private: false`, `type: "module"`, `license: "GPL-3.0-only"`, `scripts.build: "tsc -b"`, `scripts.test: "vitest run"`, zero runtime deps.
  - `packages/nukebg-core/tsconfig.json` — extends `../../tsconfig.base.json`, `composite: true`, `outDir: "./dist"`, `rootDir: "./src"`.
  - `packages/nukebg-core/src/index.ts` — empty barrel (no exports yet).
  - `packages/nukebg-core/tests/.gitkeep` — placeholder.

- [x] 1.4 Create `packages/nukebg-cli/` directory skeleton:
  - `packages/nukebg-cli/package.json` — shape from design §A.4: `name: "nukebg-cli"`, `version: "0.1.0"`, `private: false`, `type: "module"`, `license: "GPL-3.0-only"`, `bin: { nukebg: "./dist/cli.js" }`, `scripts.build: "tsup"`, `scripts.test: "vitest run"`, `dependencies` as listed in design §A.4, `devDependencies: { tsup: "^8.3.0" }`.
  - `packages/nukebg-cli/tsconfig.json` — extends `../../tsconfig.base.json`, `composite: true`, `outDir: "./dist"`, `rootDir: "./src"`, `references: [{ path: "../nukebg-core" }]`.
  - `packages/nukebg-cli/src/index.ts` — empty barrel.
  - `packages/nukebg-cli/src/cli.ts` — empty stub with shebang `#!/usr/bin/env node` and a single `console.log("nukebg-cli stub")`.
  - `packages/nukebg-cli/tests/.gitkeep` — placeholder.

- [x] 1.5 Prepare `packages/nukebg-app/` stub so the workspace declares three packages (the actual migration happens in Phase 2):
  - Create `packages/nukebg-app/` directory.
  - `packages/nukebg-app/package.json` — minimal: `name: "nukebg-app"`, `private: true`, `version: "2.12.0"`, `type: "module"`, `scripts.test: "vitest run"`. Do NOT move any files yet.
  - `packages/nukebg-app/tsconfig.json` — extends `../../tsconfig.base.json`, `composite: true`. Placeholder; filled in Phase 2.

- [x] 1.6 Update root `package.json`:
  - Add `"workspaces": ["packages/*"]`.
  - Set `name: "nukebg-monorepo"`, `private: true`.
  - Root `scripts` as per design §A.2 (`build`, `typecheck`, `test`, `test:watch`, `test:e2e`, `lint`, `format:check`, `dev`).
  - Move all runtime deps that belong to a specific package out of root `dependencies` (they will land in the correct package in later phases). Root keeps only cross-cutting devDependencies.

- [x] 1.7 Replace root `vitest.config.ts` with the Vitest projects (workspaces) config from design §A.8:
  - Three projects: `core` (node env), `cli` (node env), `app` (happy-dom env).
  - Each project's `root` points at its package directory.
  - Verify that the existing test suite still runs from root and exits green (`npm test`).

- [x] 1.8 Add root project references to `tsconfig.json`: `references` array pointing at `packages/nukebg-core`, `packages/nukebg-cli`, `packages/nukebg-app`.

- [x] 1.9 Update `.gitignore` to exclude `packages/*/dist` and `packages/*/node_modules`.

- [x] 1.10 Run `npm install` at root and verify the lockfile regenerates cleanly with three workspace packages declared.

- [x] 1.11 Verification: `npm test` (all existing tests green), `npm run lint`, `npm run typecheck`. Milestone: "monorepo skeleton with empty packages, app still on `src/`".

---

## Phase 2 — Browser App Rename + Move

_Goal: all browser app source moves from `src/` (root) → `packages/nukebg-app/src/`. Tests follow. No behavioral change._

- [x] 2.1 Move all source directories from root into `packages/nukebg-app/`:
  - `src/` → `packages/nukebg-app/src/`
  - `tests/` → `packages/nukebg-app/tests/`
  - `public/` → `packages/nukebg-app/public/`
  - `index.html` → `packages/nukebg-app/index.html`
  - `vite.config.ts` → `packages/nukebg-app/vite.config.ts`
  - Each is a directory/file move; no content changes yet.

- [x] 2.2 Update `packages/nukebg-app/tsconfig.json` to add `rootDir: "./src"`, correct `include`/`exclude` paths, and all flags appropriate for the Vite app (mirror the pre-move root tsconfig's app-relevant settings).

- [x] 2.3 Update `packages/nukebg-app/vite.config.ts` (formerly root `vite.config.ts`) — fix any root-relative paths (public dir, entry point `index.html`) that break due to the directory change.

- [x] 2.4 Update `packages/nukebg-app/package.json` to include all app-specific `dependencies` and `devDependencies` that were previously in the root (e.g., `@huggingface/transformers`, `onnxruntime-web`, `jszip`, `vite`). Add `"scripts.dev": "vite"`, `"scripts.build": "vite build"`, `"scripts.preview": "vite preview"`.

- [x] 2.5 Update root `vitest.config.ts` project entry for `app` — ensure `root: "./packages/nukebg-app"` resolves the moved test directory and `vite.config.ts` is picked up.

- [x] 2.6 Update `playwright.config.ts` at root — fix `webServer.command` and `baseURL` / `testDir` references that previously assumed `src/` and `vite.config.ts` were at root.

- [x] 2.7 Update `.github/workflows/` CI files — any hardcoded paths to `src/`, `tests/`, `vite.config.ts`, or root-level `npm test` commands that now need `--workspace=nukebg-app` or equivalent.

- [x] 2.8 Update root `tsconfig.json` references if needed after the move so `tsc -b` sees the app at its new path.

- [x] 2.9 Verification: `npm test` green at root (all component tests pass at new paths), `npm run test:e2e` passes (Playwright resolves the app), `npm run lint` clean. Milestone: "app moved, no behavioral change".

---

## Phase 3 — Core Package: Type Definitions and `ImageDataLike`

_Goal: `nukebg-core` exports its type layer and `createImageDataLike` factory. No algorithm code yet._

- [x] 3.1 Write failing tests for `ImageDataLike` structural contract and `createImageDataLike` factory (REQ-CORE-PIPELINE-2):
  - File: `packages/nukebg-core/tests/types/image-data-like.test.ts`
  - Scenarios: factory returns `{ data, width, height }` plain object; plain object satisfies the interface (type-level compile check via `@ts-expect-error` absence); `colorSpace` field is optional.

- [x] 3.2 Implement `packages/nukebg-core/src/types/image-data-like.ts` — `ImageDataLike` interface + `createImageDataLike` factory as per design §B.2. Export from `src/index.ts`. Run tests, expect green.

- [x] 3.3 Write failing tests for `PipelineOptions`, `PipelineMode`, `PipelinePrecision` types (compile-time structural checks; at least one runtime test for default-value semantics if helpers are added):
  - File: `packages/nukebg-core/tests/types/pipeline-options.test.ts`

- [x] 3.4 Implement `packages/nukebg-core/src/types/pipeline-options.ts` and `packages/nukebg-core/src/types/pipeline-result.ts` with shapes from design §B.7. Export from `src/index.ts`. Run tests, expect green.

- [x] 3.5 Write failing tests verifying `PipelineResult` shape (at minimum: `output` is `ImageDataLike`, `resolvedMode` is one of the three literal types, `durationMs` is a number, `stageTimings` contains the four required keys — REQ-CORE-PIPELINE-6):
  - File: `packages/nukebg-core/tests/types/pipeline-result.test.ts`

- [x] 3.6 Implement `packages/nukebg-core/src/types/cv-results.ts` — `BgColorResult`, `WatermarkResult`, `ClassifyImageResult`, `ImageFeatures`, `GridResult`. Export from `src/index.ts`. Run tests, expect green.

- [x] 3.7 Write failing tests for runner interface structural compliance — type-only tests asserting that an object literal satisfying `RmbgRunner`, `LamaRunner`, `ImageCodec`, `PipelineRunner` does not produce TS errors (REQ-CORE-RUNNERS-1 through 4):
  - File: `packages/nukebg-core/tests/runners/interfaces.test.ts`

- [x] 3.8 Implement runner interface files:
  - `packages/nukebg-core/src/runners/pipeline-runner.ts` (design §B.3)
  - `packages/nukebg-core/src/runners/rmbg-runner.ts` (design §B.4)
  - `packages/nukebg-core/src/runners/lama-runner.ts` (design §B.5)
  - `packages/nukebg-core/src/runners/image-codec.ts` (design §B.6)
  Export all from `src/index.ts`. Run tests, expect green.

- [x] 3.9 Write failing tests for `NukebgError` base class and the discriminated error subclasses `RmbgError`, `LamaError`, `DecodeError`, `PipelineAbortError` (REQ-CORE-RUNNERS-5, REQ-CORE-PIPELINE-4):
  - File: `packages/nukebg-core/tests/pipeline/errors.test.ts`
  - Scenarios: `error instanceof NukebgError` is true for each subclass; `error.code` is correct; `error.cause` is preserved.

- [x] 3.10 Implement `packages/nukebg-core/src/pipeline/errors.ts` — `NukebgError`, `RmbgError`, `LamaError`, `DecodeError`, `PipelineAbortError`. Export `PipelineAbortError` from `src/index.ts`. Run tests, expect green.

- [x] 3.11 Verification: `npm test` green (core + app suites), `npm run typecheck`, `npm run lint`. Milestone: "core type layer + errors exported, zero algorithm code".

---

## Phase 4 — Move Constants to Core

_Goal: `pipeline/constants.ts` is extracted to core so CV modules can import it in Phase 5._

- [x] 4.1 Move `packages/nukebg-app/src/pipeline/constants.ts` → `packages/nukebg-core/src/pipeline/constants.ts`. Update all imports in `packages/nukebg-app/src/` from the old path to `nukebg-core`. Co-located tests (if any reference constants directly) move to `packages/nukebg-core/tests/pipeline/constants.test.ts`. Run `npm test`, expect green.

- [x] 4.2 Export constants from `packages/nukebg-core/src/index.ts` per design §B.1. Run `npm test`, expect green.

- [x] 4.3 Verification: `npm test`, `npm run typecheck`, `npm run lint` all green. Milestone: "constants in core, app imports from `nukebg-core`".

---

## Phase 5 — Move Pure CV Modules to Core (Batch A: Utils + Constants)

_Goal: utility and constant CV files relocate first to unblock algorithm moves in Phase 6._

- [x] 5.1 Move the following files from `packages/nukebg-app/src/workers/cv/` → `packages/nukebg-core/src/cv/`. Move their co-located tests from `packages/nukebg-app/tests/workers/cv/` and `packages/nukebg-app/tests/cv/` → `packages/nukebg-core/tests/cv/`. Update import paths in moved files only. Run `npm test`, expect green.
  - `utils.ts` + `tests/cv/utils.test.ts`
  - `clamp.ts` + `tests/workers/cv/clamp.test.ts`

- [x] 5.2 Update `packages/nukebg-core/src/cv/index.ts` barrel to re-export `utils` and `clamp`. Export `cv` namespace from `src/index.ts`. Run `npm test`, expect green.

- [x] 5.3 Verification checkpoint: `npm test` green, `npm run typecheck`.

---

## Phase 6 — Move Pure CV Modules to Core (Batch B: Detection Algorithms)

- [x] 6.1 Move detection CV files + their tests (mechanical move + import-path rewrite only):
  - `detect-bg-colors.ts` + `tests/cv/detect-bg-colors.test.ts`
  - `detect-checker-grid.ts` + `tests/cv/detect-checker-grid.test.ts`
  - `classify-image.ts` + `tests/cv/classify-image.test.ts`
  - `sparkle-detect.ts` + `tests/cv/sparkle-detect.test.ts`
  - `watermark-detect.ts` + `tests/cv/watermark-detect.test.ts`
  - `watermark-dalle.ts` + `tests/workers/cv/watermark-dalle.test.ts`
  Run `npm test`, expect green after each file or as a batch if all move cleanly.

- [x] 6.2 Update `packages/nukebg-core/src/cv/index.ts` to export the above modules. Run `npm test`, expect green.

- [x] 6.3 Update `packages/nukebg-app/src/workers/` — any worker files that imported the moved modules must now import from `nukebg-core`. Run `npm test`, expect green.

- [x] 6.4 Verification checkpoint: `npm test`, `npm run typecheck`, `npm run lint` all green.

---

## Phase 7 — Move Pure CV Modules to Core (Batch C: Inpaint Algorithms)

- [x] 7.1 Move inpaint and flood-fill CV files + their tests:
  - `inpaint-telea.ts` + `tests/workers/cv/inpaint-telea.test.ts`
  - `inpaint-blend.ts` + `tests/cv/inpaint-blend.test.ts`
  - `patchmatch-inpaint.ts` + `tests/cv/patchmatch-inpaint.test.ts`
  - `simple-flood-fill.ts` + `tests/cv/simple-flood-fill.test.ts`
  - `grid-flood-fill.ts` + `tests/cv/grid-flood-fill.test.ts`
  Run `npm test`, expect green.

- [x] 7.2 Move remaining CV files + their tests:
  - `alpha-matting.ts` + `tests/cv/alpha-matting.test.ts`
  - `alpha-refine.ts` + `tests/cv/alpha-refine.test.ts`
  - `foreground-estimation.ts` + `tests/cv/foreground-estimation.test.ts`
  - `shadow-cleanup.ts` + `tests/cv/shadow-cleanup.test.ts`
  - `signature-threshold.ts` + `tests/cv/signature-threshold.test.ts`
  - `subject-exclusion.ts` + `tests/cv/subject-exclusion.test.ts`
  - `lama-crop.ts` + `tests/cv/lama-crop.test.ts`
  - `lama-router.ts` + `tests/cv/lama-router.test.ts`
  Run `npm test`, expect green.

- [x] 7.3 Extract the pure `patchMatchInpaint` function from `packages/nukebg-app/src/workers/inpaint.worker.ts` into `packages/nukebg-core/src/inpaint/patch-match.ts`. The worker file keeps a thin wrapper that imports from core. Run `npm test`, expect green.

- [x] 7.4 Update `packages/nukebg-core/src/cv/index.ts` barrel to export all newly moved modules. Run `npm test`, expect green.

- [x] 7.5 Verification: `npm test`, `npm run typecheck`, `npm run lint` all green. Milestone: "all 21 CV modules + patchmatch in core; app workers import from `nukebg-core`".

---

## Phase 8 — Port Semi-Pure Modules: `ImageDataLike` Migration

_Goal: the 7 `new ImageData(...)` call sites in pipeline utils are replaced with `createImageDataLike`. Strict TDD per file._

- [x] 8.1 Move `packages/nukebg-app/src/pipeline/finalize.ts` → `packages/nukebg-core/src/pipeline/finalize.ts` and move `packages/nukebg-app/tests/pipeline/finalize.test.ts` → `packages/nukebg-core/tests/pipeline/finalize.test.ts` (mechanical move, import paths only). Run `npm test`, expect green.

- [x] 8.2 Write failing tests in `packages/nukebg-core/tests/pipeline/finalize.test.ts` that assert each of the four `finalize.ts` call sites (`fillSubjectHoles`, `dropOrphanBlobs`, `promoteSpeckleAlpha`, `refineEdges`) returns a plain object satisfying `ImageDataLike` (not an `ImageData` instance). Confirm these tests fail before the refactor (REQ-CORE-PIPELINE-2, design §F rows 1–4).

- [x] 8.3 Replace each `new ImageData(out, width, height)` in `packages/nukebg-core/src/pipeline/finalize.ts` with `createImageDataLike(out, width, height)`. Remove the `ImageData` global dependency from the file. Run tests, expect green.

- [x] 8.4 Write failing tests for `final-composite.ts` asserting return value is a plain `ImageDataLike` (design §F rows 5–6). These tests should NOT polyfill `ImageData` — construct plain objects directly.
  - File: `packages/nukebg-core/tests/pipeline/final-composite.test.ts` (updated from app's moved test).

- [x] 8.5 Move `packages/nukebg-app/src/utils/final-composite.ts` → `packages/nukebg-core/src/pipeline/final-composite.ts`. Move its test. Replace two `new ImageData(...)` sites with `createImageDataLike`. DELETE the `ImageData` polyfill from the test file. Run tests, expect green.

- [x] 8.6 Write failing test for `auto-crop.ts` asserting the return is a plain `ImageDataLike` (design §F row 7).
  - File: `packages/nukebg-core/tests/pipeline/auto-crop.test.ts`.

- [x] 8.7 Move `packages/nukebg-app/src/utils/auto-crop.ts` → `packages/nukebg-core/src/pipeline/auto-crop.ts`. Move its test. Replace `new ImageData(out, cw, ch)` with `createImageDataLike`. Run tests, expect green.

- [x] 8.8 Move `packages/nukebg-app/src/pipeline/finalize-result.ts` → `packages/nukebg-core/src/pipeline/finalize-result.ts`. Move `tests/pipeline/finalize-result.test.ts`. Apply any `ImageDataLike` changes needed. Run tests, expect green.

- [x] 8.9 Update all imports in `packages/nukebg-app/src/` that previously referenced the moved files to import from `nukebg-core` (or its re-exports). Run `npm test`, expect green.

- [x] 8.10 Verification: `npm test`, `npm run typecheck`, `npm run lint` all green. Milestone: "`ImageDataLike` adopted everywhere in core; no `new ImageData(...)` in core source".

---

## Phase 9 — `runPipeline` Implementation in Core

_Goal: runtime-agnostic pipeline orchestrator implemented. Strict TDD with stub runners._

- [x] 9.1 Write failing contract tests for `runPipeline` happy-path scenarios using stub/mock runners (REQ-CORE-PIPELINE-1, REQ-CORE-PIPELINE-6):
  - File: `packages/nukebg-core/tests/pipeline/run-pipeline.test.ts`
  - Scenarios:
    - Happy path with `mode: "photo"`, `skipWatermark: false` → `PipelineResult` with `output: ImageDataLike`, all four `stageTimings` keys present, `durationMs > 0`.
    - `skipWatermark: true` → LaMa runner stub never called.
    - `mode: "auto"` → `resolvedMode` is one of `photo | signature | icon`.
    - SIGNATURE shortcut → RMBG runner not called.

- [x] 9.2 Write failing tests for abort behavior (REQ-CORE-PIPELINE-3):
  - Abort before RMBG → rejects with `PipelineAbortError`.
  - No signal → resolves normally.

- [x] 9.3 Write failing tests for typed error propagation (REQ-CORE-PIPELINE-4):
  - RmbgRunner throws → rejects with `RmbgError` wrapping the original error.
  - LamaRunner throws → rejects with `LamaError` wrapping the original error.

- [x] 9.4 Implement `packages/nukebg-core/src/pipeline/run-pipeline.ts` — algorithm from design §D.1. Private helpers `composeResult`, `combineMasks`, `modeToContentType` in the same file. No `new ImageData()`. Run all three test groups, expect green.

- [x] 9.5 Export `runPipeline` and `RunnerBundle` from `packages/nukebg-core/src/index.ts`. Run `npm test`, expect green.

- [x] 9.6 Split `packages/nukebg-app/tests/pipeline/orchestrator.test.ts` — move pipeline-logic tests to `packages/nukebg-core/tests/pipeline/run-pipeline.test.ts` (already started in 9.1); keep Worker-boundary mocking tests in a new `packages/nukebg-app/tests/pipeline/worker-pipeline-runner.test.ts`. Run `npm test`, expect green.

- [x] 9.7 Verification: `npm test`, `npm run typecheck`, `npm run lint` all green. Milestone: "`runPipeline` live in core, contract-tested with stubs".

---

## Phase 10 — Browser App Adapts to `PipelineRunner` Interface

_Goal: `PipelineOrchestrator` → `WorkerPipelineRunner`. Browser app satisfies `PipelineRunner`. Tests updated._

- [x] 10.1 Write failing test in `packages/nukebg-app/tests/pipeline/worker-pipeline-runner.test.ts` asserting that `WorkerPipelineRunner` (class not yet renamed) satisfies the `PipelineRunner` interface — i.e., a variable typed `PipelineRunner` can be assigned an instance without TypeScript error (REQ-PARITY-2).

- [x] 10.2 Rename `packages/nukebg-app/src/pipeline/orchestrator.ts` → `packages/nukebg-app/src/pipeline/worker-pipeline-runner.ts`. Rename the class `WorkerPipelineRunner`. Change `process(imageData: ImageData, ...)` → `run(input: ImageDataLike, options?: PipelineOptions): Promise<PipelineResult>`. Add `preload()` and `dispose()` stubs. Import `PipelineRunner` from `nukebg-core` and declare `implements PipelineRunner`. Run tests, expect green.

- [x] 10.3 Delete `packages/nukebg-app/src/pipeline/image-processor.ts`. Update all imports of `ImageProcessor` in browser app components to `PipelineRunner` from `nukebg-core`. Run `npm test`, expect green.

- [x] 10.4 Update browser app components (`ar-*.ts`) that construct or reference `PipelineOrchestrator`:
  - Change construction to `WorkerPipelineRunner`.
  - Rename `.process(...)` calls → `.run(...)`.
  - Reshape any `modelId`, `precision` parameters into `PipelineOptions`.
  Estimate ~10 spots (design §E.2). Run `npm test`, expect green after each component or as a batch.

- [x] 10.5 Update browser worker files that imported from the old `pipeline/constants` path (now `nukebg-core`) and any remaining direct imports of moved CV files. Run `npm test`, expect green.

- [x] 10.6 Verify `WorkerPipelineRunner` satisfies `PipelineRunner` at the type level (compile check). Run `npm run typecheck`, expect zero errors (REQ-PARITY-2).

- [x] 10.7 Verification: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e` all green. Milestone: "browser uses `WorkerPipelineRunner`, behavior unchanged, e2e passes".

---

## Phase 11 — CLI: `SharpImageCodec`

_Goal: first Node-side adapter. Strict TDD: encode/decode round-trip._

- [x] 11.1 Write failing tests for `SharpImageCodec.decode` (REQ-CORE-RUNNERS-3):
  - File: `packages/nukebg-cli/tests/codecs/sharp-codec.test.ts`
  - Scenarios:
    - Valid PNG bytes → `ImageDataLike` with correct `width`, `height`, non-empty `data` (length = `width * height * 4`).
    - Valid JPEG bytes → same.
    - Invalid bytes (non-image) → rejects with `DecodeError`, `error.code === "DECODE_FAILED"`.
    - Alpha channel preserved: encode RGBA with transparent pixels → decode back → alpha values match.

- [x] 11.2 Implement `packages/nukebg-cli/src/codecs/sharp-codec.ts` — `SharpImageCodec implements ImageCodec` using `sharp`. Format detection by magic bytes. Run tests, expect green.

- [x] 11.3 Write failing tests for `SharpImageCodec.encode`:
  - PNG output starts with PNG magic bytes.
  - WebP output starts with RIFF/WEBP header.
  - Round-trip: encode PNG then decode → pixel data identical.

- [x] 11.4 Implement `encode` method in `SharpImageCodec`. Run tests, expect green.

- [x] 11.5 Refactor if needed (extract magic-byte detection to a private helper). Run tests, expect green.

- [x] 11.6 Verification: `npm test` (CLI project only: `npm test -w nukebg-cli`), `npm run typecheck`. Milestone: "`SharpImageCodec` implemented and round-trip tested".

---

## Phase 12 — CLI: `OnnxNodeRmbgRunner`

_Goal: RMBG-1.4 via `@huggingface/transformers` Node mode. Cache resolution unit-testable; model load via contract test._

- [x] 12.1 Write failing unit tests for cache directory resolution logic (design §I.1):
  - File: `packages/nukebg-cli/tests/runners/rmbg-cache.test.ts`
  - Scenarios:
    - `--cache-dir` flag value takes priority over env vars.
    - `TRANSFORMERS_CACHE` env var used when flag absent.
    - `HF_HOME` used when `TRANSFORMERS_CACHE` absent.
    - `env-paths('nukebg').cache` used as final fallback.

- [x] 12.2 Implement `resolveCacheDir(flagValue?: string): string` as an exported helper in `packages/nukebg-cli/src/runners/onnx-node-rmbg.ts`. Run tests, expect green.

- [x] 12.3 Write failing tests for `OnnxNodeRmbgRunner.segment` using a tiny 1×1 fixture model or a spy/stub on `@huggingface/transformers` pipeline (contract test — REQ-CORE-RUNNERS-1):
  - File: `packages/nukebg-cli/tests/runners/onnx-node-rmbg.test.ts`
  - Scenarios:
    - `segment` returns `Uint8Array` of length `width * height`.
    - `AbortSignal` fired before call → rejects with `PipelineAbortError`.

- [x] 12.4 Implement `OnnxNodeRmbgRunner implements RmbgRunner` in `packages/nukebg-cli/src/runners/onnx-node-rmbg.ts` using `@huggingface/transformers` pipeline API from design §I.1. Run tests, expect green.

- [x] 12.5 Write failing test: model integrity hash mismatch → rejects with `RmbgError` code `"RMBG_INTEGRITY_FAILED"` (REQ-CORE-RUNNERS-1 integrity scenario). Implement the post-download integrity check. Run tests, expect green.

- [x] 12.6 Verification: `npm test -w nukebg-cli`, `npm run typecheck`. Milestone: "`OnnxNodeRmbgRunner` implemented with cache resolution and integrity check".

---

## Phase 13 — CLI: `OnnxNodeLamaRunner`

_Goal: LaMa via `onnxruntime-node` directly. Same pattern as RMBG runner._

- [x] 13.1 Write failing tests for `OnnxNodeLamaRunner` cache + download logic:
  - File: `packages/nukebg-cli/tests/runners/onnx-node-lama.test.ts`
  - Scenarios:
    - Cache hit: reads from disk, skips download.
    - Cache miss: fetches from `LAMA_PARAMS.MODEL_URL`, validates size, writes to cache, creates session.
    - HTTP failure after download → rejects with `LamaError` code `"LAMA_DOWNLOAD_FAILED"` (REQ-CORE-RUNNERS-2).
    - SHA-256 mismatch → rejects with `LamaError`.

- [x] 13.2 Implement `OnnxNodeLamaRunner implements LamaRunner` in `packages/nukebg-cli/src/runners/onnx-node-lama.ts` — loading logic from design §I.2. Tensor pre/post-processing (Float32Array packing, ORT Tensor construction) stays in the runner. Run tests, expect green.

- [x] 13.3 Write failing tests for `inpaint` method:
  - Output is `Uint8ClampedArray` of length `width * height * 4`.
  - Output dimensions match input dimensions.

- [x] 13.4 Implement `inpaint` method. Run tests, expect green.

- [x] 13.5 Verification: `npm test -w nukebg-cli`, `npm run typecheck`. Milestone: "`OnnxNodeLamaRunner` implemented with integrity check".

---

## Phase 14 — CLI: `NodePipelineRunner`

_Goal: inline runner wiring codec + runners into `runPipeline`. Contract-tested._

- [x] 14.1 Write failing tests for `NodePipelineRunner` using stub runners (REQ-CORE-RUNNERS-4 Node scenario):
  - File: `packages/nukebg-cli/tests/runners/node-pipeline-runner.test.ts`
  - Scenarios:
    - `runner.run(image, options)` delegates to `runPipeline` and returns `PipelineResult`.
    - `dispose()` calls `rmbgRunner.dispose()` and `lamaRunner.dispose()`.
    - `preload()` calls `rmbgRunner.load()`.

- [x] 14.2 Implement `NodePipelineRunner implements PipelineRunner` in `packages/nukebg-cli/src/runners/node-pipeline-runner.ts`. Run tests, expect green.

- [x] 14.3 Refactor if needed. Run tests, expect green.

- [x] 14.4 Verification: `npm test -w nukebg-cli`, `npm run typecheck`. Milestone: "`NodePipelineRunner` wires core `runPipeline` with Node adapters".

---

## Phase 15 — CLI: License Gate

_Goal: all REQ-CLI-LICENSE-* scenarios passing. State-machine tests per spec._

- [x] 15.1 Write failing tests for `LicenseMarker` read/write/validate logic (REQ-CLI-LICENSE-3):
  - File: `packages/nukebg-cli/tests/license/marker.test.ts`
  - Scenarios:
    - Valid JSON with correct `version`, `acknowledged`, `acceptedAt` → returns `LicenseMarker`.
    - Invalid JSON → returns `null`.
    - `version !== 1` → returns `null`.
    - `acknowledged` value wrong → returns `null`.
    - Write uses atomic temp-file + rename pattern.

- [x] 15.2 Implement `packages/nukebg-cli/src/license/marker.ts` — `LicenseMarker` schema, `readMarker()`, `writeMarker()`, `deleteMarker()` using `env-paths` for config dir resolution (design §G.1, §G.2). Run tests, expect green.

- [x] 15.3 Write failing tests for `gate.ts` state machine covering all five branches (REQ-CLI-LICENSE-1, REQ-CLI-LICENSE-2):
  - File: `packages/nukebg-cli/tests/license/gate.test.ts`
  - Scenarios:
    - Valid marker exists → `assertAccepted()` resolves without prompt.
    - No marker + `--accept-non-commercial` flag → writes marker, resolves.
    - No marker + TTY → prompts; answer `y` → writes marker, resolves.
    - No marker + TTY → prompts; answer `N` (or Enter) → throws `LicenseRequiredError`.
    - No marker + non-TTY + no flag → throws `LicenseRequiredError` immediately.
    - Corrupted marker + TTY → treats as absent, shows prompt.

- [x] 15.4 Implement `packages/nukebg-cli/src/license/gate.ts` — `assertAccepted()`, `accept()`, `revoke()`, `state()` (design §G.3, §G.4, §G.5). Use `node:readline/promises` for prompt. Prompt goes to stderr. Run tests, expect green.

- [x] 15.5 Write failing tests for `nukebg license` subcommand output (REQ-CLI-LICENSE-4):
  - File: `packages/nukebg-cli/tests/commands/license.test.ts`
  - Scenarios:
    - Accepted marker → stdout contains `Status: accepted` + ISO timestamp + CC-BY-NC-4.0 notice.
    - No marker → stdout contains `Status: not accepted`.
    - `--revoke` → marker deleted, confirmation printed.

- [x] 15.6 Implement `packages/nukebg-cli/src/commands/license.ts` — license subcommand handler. Run tests, expect green.

- [x] 15.7 Verification: `npm test -w nukebg-cli`, `npm run typecheck`. Milestone: "license gate fully tested and implemented".

---

## Phase 16 — CLI: Entrypoint, Argparser, and Error Wiring

_Goal: `commander` wiring, exit-code mapping, all CLI invocation scenarios from spec._

- [x] 16.1 Write failing tests for exit-code mapping (REQ-CLI-INVOCATION-6, design §H.3):
  - File: `packages/nukebg-cli/tests/util/errors.test.ts`
  - Scenarios: each named error class maps to its `ExitCode` constant; unknown error → `PIPELINE_FAILED`.

- [x] 16.2 Implement `packages/nukebg-cli/src/util/exit-codes.ts` (frozen `ExitCode` enum, design §H.2) and `packages/nukebg-cli/src/util/errors.ts` (`exitCodeFor` function + named error classes). Run tests, expect green.

- [x] 16.3 Write failing tests for the `process` command handler (REQ-CLI-INVOCATION-1 through 5):
  - File: `packages/nukebg-cli/tests/commands/process.test.ts`
  - Scenarios (mock filesystem, mock runners):
    - Missing input file → exits `NO_INPUT` (66) with message on stderr. **DEVIATION**: implemented/tested as 66 (`EX_NOINPUT`) per REQ-CLI-INVOCATION-2's explicit scenario and REQ-CLI-INVOCATION-6's exit table, not the `USER_ERROR` (64) this line originally said — see exit-codes.ts doc comment and apply-progress.
    - Non-image bytes → exits `INPUT_DECODE_FAILED` (65).
    - Valid image, no `-o` → output written to `<stem>.nukebg.png` in same directory.
    - `-o result.png` → output at explicit path.
    - `--format webp` → output starts with RIFF/WEBP header.
    - `--no-watermark` → LamaRunner never constructed.
    - `--mode icon --precision high` → options forwarded to pipeline.
    - `--quiet` → stderr empty.
    - `--verbose` → stderr contains timing lines.
    - Model download failure → exits `MODEL_DOWNLOAD_FAILED` (74).
    - Pipeline failure → exits `PIPELINE_FAILED` (70).

- [x] 16.4 Implement `packages/nukebg-cli/src/commands/process.ts` — `ProcessCommand` that decodes input, runs license gate, loads runners, calls `runPipeline` via `NodePipelineRunner`, encodes output, writes file (design §D.2 sequence). Run tests, expect green.

- [x] 16.5 Write failing tests for the `version.ts` helper (resolves package version at build time):
  - File: `packages/nukebg-cli/tests/util/version.test.ts`
  - Scenario: version string matches semver pattern.

- [x] 16.6 Implement `packages/nukebg-cli/src/util/version.ts`. Run tests, expect green.

- [x] 16.7 Implement `packages/nukebg-cli/src/cli.ts` — commander setup wiring `process` command and `license` subcommand per design §H.1 and §H.6 option set. Handle SIGINT → exit `ABORTED` (130). Run existing tests, expect green.
  - Unblocked: `commander@12.1.0` installed and resolves (root `node_modules/commander`, dual ESM/CJS `exports` map). `runCli(argv, deps)` returns the resolved exit code rather than calling `process.exit` directly (mirrors `ProcessCommand.execute`'s testable pattern); the real `main()` entrypoint (guarded by an `isMainModule()` check) is the only place that calls `process.exit`. `errors.ts`'s `CommanderError` detection was upgraded from name-based duck-typing to a real `instanceof commander.CommanderError` now that the package resolves.

- [x] 16.8 Write failing tests for unrecognized flag behavior (REQ-CLI-INVOCATION-1 unrecognized flag scenario) and `--help` / `--version` exit codes. Run tests, expect green.
  - File: `packages/nukebg-cli/tests/cli.test.ts` (8 tests total, covering process-option forwarding, `license`/`--revoke` dispatch, unrecognized flag → `USER_ERROR` (64), missing `<input>` → `USER_ERROR` (64), `--help` → `OK` (0), `--version` → `OK` (0) with version string on stdout).

- [x] 16.9 Smoke test: run `npx tsx packages/nukebg-cli/src/cli.ts --version` (tsx from `node_modules/.bin`; `npm run build -w nukebg-cli` still can't run — no `tsup.config.ts` until Phase 19, unchanged from the earlier note). Output: `0.1.0`, exit code `0`. Confirmed. Real dist-build smoke test remains deferred to Phase 19.

- [x] 16.10 Verification: `npm test`, `npm run typecheck`, `npm run lint` all green. `npm test -w nukebg-cli`: 76/76. Full monorepo `npm test`: 1137/1137 (737 nukebg-app + 76 nukebg-cli + 324 nukebg-core). `npm run typecheck` (all 3 workspaces): green. `npm run lint` (root → nukebg-app only, pre-existing scope, unrelated to this phase): green. Milestone "CLI entrypoint wired, all invocation scenarios tested" — MET.

---

## Phase 17 — Browser ↔ Node Pixel Parity Test

_Goal: automated cross-runtime parity test. REQ-PARITY-1 and REQ-PARITY-4._

- [ ] 17.1 Add parity fixture images to the repository:
  - `packages/nukebg-core/tests/fixtures/parity/portrait-512x512.png` — human portrait, white background.
  - `packages/nukebg-core/tests/fixtures/parity/product-800x600.jpg` — product with watermark.
  - `packages/nukebg-core/tests/fixtures/parity/logo-256x256.png` — icon with transparent background.
  These are binary assets committed directly.

- [ ] 17.2 Write parity test file:
  - File: `packages/nukebg-core/tests/parity/parity.test.ts`
  - Skip guard: if RMBG model is not cached and `NUKEBG_PARITY_REQUIRE` env var is not set, skip with message `"Skipping parity test — RMBG model not cached (set NUKEBG_PARITY_REQUIRE=1 to force)"` (REQ-PARITY-4).
  - For each fixture, run through `NodePipelineRunner` and compare alpha channels.
  - Assert alpha difference ≤ ε = 2 per pixel, pixels with difference > 0 are < 5% of total (REQ-PARITY-1).
  - Assert RGB channels in subject pixels are identical (ε = 0).
  - Document ε and fixture set in comments.

- [ ] 17.3 Verify parity test is skipped locally (no model cached) with the expected skip message. Verify it does NOT fail (just skip). Run `npm test`, expect green.

- [ ] 17.4 Verification: `npm test`, `npm run typecheck`. Milestone: "parity test framework in place; will enforce pixel equivalence in CI with cached models".

---

## Phase 18 — CI Matrix

_Goal: GitHub Actions runs CLI build + test on Linux x64, macOS arm64, Windows x64._

- [ ] 18.1 Create or update `.github/workflows/cli.yml` — matrix strategy:
  - OS: `ubuntu-latest` (x64), `macos-latest` (arm64), `windows-latest` (x64).
  - Steps: checkout, `npm ci`, `npm run build -w nukebg-cli`, `npm test -w nukebg-cli`.
  - Cache `~/.npm` per OS.
  - Set `NUKEBG_PARITY_REQUIRE=1` only when model cache is pre-populated (if not, skip parity in CI first-pass until cache strategy is defined).

- [ ] 18.2 Ensure existing `.github/workflows/` CI (browser app, e2e) is unchanged and continues to run independently of the CLI workflow.

- [ ] 18.3 Verification: push to a feature branch and confirm all three OS legs pass in GitHub Actions. Milestone: "CLI CI matrix green on all three platforms".

---

## Phase 19 — Distribution Wiring

_Goal: `nukebg-core` and `nukebg-cli` publishable packages. `npm pack --dry-run` clean._

- [ ] 19.1 Finalize `packages/nukebg-core/package.json`:
  - Confirm `name: "nukebg-core"`, `version: "0.1.0"`, `private: false`, `license: "GPL-3.0-only"`.
  - Set `exports: { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` and `types: "./dist/index.d.ts"` (REQ-DIST-2).
  - Set `files: ["dist", "README.md", "LICENSE"]`.
  - Set `engines: { "node": ">=20.0.0" }`.
  - Confirm zero runtime `dependencies`.

- [ ] 19.2 Finalize `packages/nukebg-cli/package.json`:
  - Confirm `name: "nukebg-cli"`, `version: "0.1.0"`, `private: false`, `license: "GPL-3.0-only"`.
  - Confirm `bin: { nukebg: "./dist/cli.js" }` (REQ-DIST-3).
  - Set `files: ["dist", "README.md", "LICENSE"]`.
  - Set `engines: { "node": ">=20.0.0" }`.
  - Confirm `dependencies` include `nukebg-core` (workspace protocol), `onnxruntime-node`, `sharp`, `commander`, `env-paths`. `onnxruntime-web` must NOT appear (REQ-DIST-3).

- [ ] 19.3 Confirm `packages/nukebg-app/package.json` has `private: true` and depends on `nukebg-core` via workspace protocol (REQ-DIST-4).

- [ ] 19.4 Set `repository`, `bugs`, and `homepage` fields in both publishable `package.json` files.

- [ ] 19.5 Add `tsup.config.ts` to `packages/nukebg-cli/` configuring: ESM output, single-file `dist/cli.js`, shebang `#!/usr/bin/env node`, `--external onnxruntime-node` so native `.node` addons are not bundled (design §A.7).

- [ ] 19.6 Run `npm run build -w nukebg-core` → verify `packages/nukebg-core/dist/` contains per-file `.js` + `.d.ts` tree.

- [ ] 19.7 Run `npm run build -w nukebg-cli` → verify `packages/nukebg-cli/dist/cli.js` exists with shebang and no `onnxruntime-web` references.

- [ ] 19.8 Run `npm pack --dry-run -w nukebg-core` → verify tarball includes only `dist/`, `README.md`, `LICENSE`. Confirm no ORT/DOM runtime in the listed files.

- [ ] 19.9 Run `npm pack --dry-run -w nukebg-cli` → verify tarball includes `dist/`, `README.md`, `LICENSE`. Confirm no `onnxruntime-web` in the listed files (REQ-DIST-3).

- [ ] 19.10 Run `npm publish --workspaces --dry-run` → verify `nukebg-app` is NOT listed for publishing (REQ-DIST-4).

- [ ] 19.11 Verify workspace dep graph is acyclic: `npm ls --workspaces` exits clean, no cycle reported (REQ-DIST-6).

- [ ] 19.12 Verification: `npm test`, `npm run typecheck`, `npm run lint`, `npm pack --dry-run` all clean. Milestone: "ready to publish, not published".

---

## Phase 20 — Documentation

_Goal: all README and CONTRIBUTING files updated. REQ-CLI-LICENSE-5 satisfied._

- [ ] 20.1 Write `packages/nukebg-cli/README.md`:
  - License banner: "CC-BY-NC-4.0" text and BRIA AI license URL appear before the first code block (REQ-CLI-LICENSE-5).
  - Install section: `npm install -g nukebg-cli`.
  - Usage section: cover all flags from design §H.6.
  - License gate section: explain RMBG-1.4 CC-BY-NC-4.0, first-run prompt, `--accept-non-commercial` for CI.
  - Supported platforms section: Linux x64, macOS arm64, Windows x64. Note: macOS x64 and Linux arm64 untested.

- [ ] 20.2 Write `packages/nukebg-core/README.md`:
  - Public API reference: `ImageDataLike`, `PipelineRunner`, `RmbgRunner`, `LamaRunner`, `ImageCodec`, `runPipeline`, error classes.
  - Usage example for embedding in a Node app (programmatic use, injecting own runners).
  - Note that `nukebg-core` has zero runtime dependencies.

- [ ] 20.3 Update root `README.md`:
  - Add monorepo map pointing at the three packages.
  - Add link to `nukebg-cli/README.md` for CLI users.
  - Keep existing browser-app usage documentation.

- [ ] 20.4 Update `CONTRIBUTING.md` (or create if absent):
  - Workspace dev workflow: `npm install` at root, per-package `npm test -w <pkg>`, `npm run dev -w nukebg-app` for the browser app.
  - Strict TDD convention: tests before code.
  - Conventional commits reminder (no AI attribution).

- [ ] 20.5 Verification: `npm test`, `npm run lint` green. Confirm `packages/nukebg-cli/README.md` contains "CC-BY-NC-4.0" before the first code block. Milestone: "documentation complete; change ready for review".

---

## Cross-Phase Considerations

- [ ] X.1 **Lock file hygiene**: after each phase that modifies `package.json` files (Phases 1, 2, 4, 11, 12, 13, 14, 19), run `npm install` at root and commit the updated `package-lock.json` as part of that phase's commit.

- [ ] X.2 **`eslint.config.js` path coverage**: after Phase 2 moves `src/` to `packages/nukebg-app/src/`, verify the flat ESLint config's `rootDir` still resolves all three package directories. Adjust globs if needed. Run `npm run lint` clean.

- [ ] X.3 **Vitest `include` patterns**: after each batch move in Phases 5–8, confirm root `vitest.config.ts` picks up the new test paths under `packages/nukebg-core/tests/`. Add explicit `include` patterns if Vitest's default discovery misses any file.

- [ ] X.4 **`no-unsanitized` ESLint rule scope**: after Phase 2, confirm the `no-unsanitized` lint rule (added in commit `f54eac8`) still applies to `packages/nukebg-app/src/` and does NOT apply to `packages/nukebg-core/src/` or `packages/nukebg-cli/src/` (no DOM in those).

- [ ] X.5 **`tsconfig` project references**: after each new package or move, update the root `tsconfig.json` references array and run `tsc -b` to confirm no missing-reference errors. Do not defer — broken references silently invalidate incremental builds.

- [ ] X.6 **CI secret / model cache**: before Phase 18, decide and document the CI strategy for caching RMBG and LaMa models (GitHub Actions cache key based on model SHA from `LAMA_PARAMS.EXPECTED_SHA256`). Parity tests run with `NUKEBG_PARITY_REQUIRE=1` only on the leg that has the cache populated.

- [x] X.7 **`finalize-chain` and `pending-timers` tests**: `finalize-chain.test.ts` moved to `packages/nukebg-core/tests/pipeline/finalize-chain.test.ts` (imports only core finalize functions — no DOM). `pending-timers.test.ts` stays in app (reads `orchestrator.ts` and `worker-channel.ts` source files which live in the app).
