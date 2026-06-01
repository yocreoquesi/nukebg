# Exploration — Extract Core + CLI from nukebg

## Executive Summary

Extracting a Node-usable core is feasible with **medium effort**. ~80% of the CV algorithm code (`src/workers/cv/*.ts`) is already pure TypeScript with zero browser coupling. The three hard seams to cross are: image I/O (replace `createImageBitmap`/`OffscreenCanvas` with `sharp`), ML model loading (swap `onnxruntime-web` for `onnxruntime-node` and `@huggingface/transformers` Node mode), and the threading model (replace `WorkerChannel + Web Workers` with an inline `NodePipelineRunner`). The `onnxruntime-web` / `onnxruntime-node` package conflict is the single largest structural constraint and must drive the package layout decision in the proposal.

## Coupling Matrix

| Module | Category | Notes |
|---|---|---|
| `src/workers/cv/*.ts` (20 files) | **pure** | Confirmed via grep: no `document`, `window`, `OffscreenCanvas`, `postMessage`, `HTMLElement`. Only `Uint8Array`, `Uint8ClampedArray`, `Float32Array` + constants. |
| `src/pipeline/constants.ts` | **pure** | Zero imports, all numeric literals. |
| `src/pipeline/image-processor.ts` | **pure** | Interface only. |
| `src/pipeline/finalize.ts` | **semi-pure** | `new ImageData(...)` at lines 250, 335, 391, 574. Otherwise pure math. |
| `src/pipeline/finalize-result.ts` | **semi-pure** | Delegates to `composeAtOriginal` which emits `ImageData`. |
| `src/utils/final-composite.ts` | **semi-pure** | `new ImageData(out, oW, oH)` at lines 202, 254. |
| `src/utils/auto-crop.ts` | **semi-pure** | `new ImageData(out, cw, ch)` at line 73. |
| `src/utils/capability-detector.ts` | **semi-pure** | All `navigator`/`performance` accesses guarded with `typeof !== 'undefined'`. Runs safely in Node, picks 'high' tier. |
| `src/pipeline/orchestrator.ts` | **worker-bound** | `new Worker(new URL(..., import.meta.url), ...)` at lines 71, 82, 104, 118. `import.meta.env.DEV` at lines 343, 438, 586. |
| `src/pipeline/worker-channel.ts` | **worker-bound** | Entire abstraction is `Worker + postMessage`. `crypto.randomUUID` already has a fallback. |
| `src/workers/ml.worker.ts` | **browser-runtime** | `caches.open` (Cache API), `self.navigator.hardwareConcurrency`, `@huggingface/transformers` (browser WASM config). |
| `src/workers/lama.worker.ts` | **browser-runtime** | `onnxruntime-web`, `ort.env.wasm.wasmPaths` (CDN), `fetch` to HF CDN, `crypto.subtle`. |
| `src/workers/sam.worker.ts` | **browser-runtime** | Same pattern as lama. |
| `src/workers/inpaint.worker.ts` | **worker-bound** | Thin shell; inner `patchMatchInpaint` is pure. |
| `src/utils/image-io.ts` | **dom-bound** | `createImageBitmap`, `OffscreenCanvas`, `HTMLCanvasElement`, `File`. Full replacement with `sharp`. |

**Verdict**: only `image-io.ts` (I/O boundary), three browser-runtime workers (ML, LaMa, SAM), and `orchestrator.ts` + `worker-channel.ts` (threading model) need real porting work.

## I/O Boundary

**Browser today**

```
File (drag-drop)
  → createImageBitmap(file)               ← DOM API
  → OffscreenCanvas / HTMLCanvasElement
  → ctx.getImageData()
  → ImageData { data: Uint8ClampedArray, width, height }
  → PipelineOrchestrator.process(imageData)
  → Workers receive typed arrays (Transferable buffers)
  → PipelineResult { imageData: ImageData, workingPixels, workingAlpha... }
  → exportPng(imageData)
  → OffscreenCanvas → convertToBlob → Blob
  → <a> download
```

**Node CLI**

```
file path argument (or stdin)
  → sharp(path).raw().toBuffer()          ← sharp replaces createImageBitmap
  → { data: Buffer, width, height, channels: 4 }
  → wrap as Uint8ClampedArray, create ImageDataLike stub
  → NodePipelineRunner.process(imageDataLike)
  → pure CV functions called inline (no Workers)
  → NodePipelineResult { data, width, height, workingAlpha }
  → sharp({ raw: { width, height, channels: 4 } }).png().toBuffer()
  → fs.writeFile(outputPath, buffer)
```

The `ImageData` type appears at 7 call sites. Proposal must decide: (a) polyfill `ImageData` in Node (Node 22 native; Node 20 needs ≈14-line struct stub — pattern already established in `tests/utils/final-composite.test.ts`), or (b) replace `ImageData` references in core with a local `ImageDataLike` interface and keep `ImageData` only at the browser entry boundary.

## Model Loading

### RMBG-1.4
- **Browser**: `@huggingface/transformers` v3 → `transformers.pipeline('image-segmentation', ...)` → model from HuggingFace CDN, cached via Cache API (`caches.open('transformers-cache')`). Integrity via `crypto.subtle.digest`.
- **Node**: `@huggingface/transformers` v3 supports Node with `onnxruntime-node` backend. Cache dir = `~/.cache/huggingface` or `$TRANSFORMERS_CACHE`. The `caches.open` integrity path skips silently when `typeof caches === 'undefined'` (`ml.worker.ts:39`). Implement Node-native integrity with `crypto.createHash('sha256')` from `node:crypto`.

### LaMa ONNX
- **Browser**: `onnxruntime-web`, WASM from jsDelivr CDN (`ort.env.wasm.wasmPaths`), model from HF via `fetch`. SHA-256 via `crypto.subtle`.
- **Node**: replace import with `onnxruntime-node`. Remove `ort.env.wasm.wasmPaths`. Use `ort.InferenceSession.create(buffer, { executionProviders: ['cpu'] })`. SHA-256 via `node:crypto`.

### Critical conflict
`onnxruntime-web` and `onnxruntime-node` cannot be direct dependencies in the same npm package. **This forces the package-layout decision.**

## Hidden Traps (file:line)

| Trap | Location | Node-safe? |
|---|---|---|
| `caches.open(...)` | `ml.worker.ts:43` | Guarded → safe, but no integrity check. |
| `self.navigator.hardwareConcurrency` | `ml.worker.ts:403–406` | Guarded → safe. |
| `performance.now()` | `ml.worker.ts:394, 423, 430` | Available in Node ≥16 → safe. |
| `ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/...'` | `lama.worker.ts:35`, `sam.worker.ts:23` | Must be REMOVED for onnxruntime-node. |
| `crypto.subtle.digest('SHA-256', buf)` | `lama.worker.ts:105`, `ml.worker.ts:65`, `sam.worker.ts:85` | Available in Node ≥18 → safe. |
| `new Worker(new URL(..., import.meta.url), ...)` | `orchestrator.ts:71,82,104,118` | Browser + Vite only. Node needs inline-call adapter. |
| `import.meta.env.DEV` | `orchestrator.ts:343,438,586` | Vite-injected. In Node: replace with `process.env.NODE_ENV === 'development'`. |
| `createImageBitmap`, `OffscreenCanvas` | `image-io.ts:89, 134–149, 158–200` | Replace with `sharp`. |
| `new ImageData(out, w, h)` | `final-composite.ts:202,254`, `finalize.ts:250,335,391,574`, `auto-crop.ts:73`, `orchestrator.ts:592` | Node 22 native; Node 20 needs polyfill. |

## Test Reusability

**Directly portable (no changes)**
- `tests/cv/*.test.ts` (12 files) — import from `src/workers/cv/*` directly.
- `tests/workers/cv/*.test.ts` (3 files) — same pattern.
- `tests/utils/final-composite.test.ts` — already has 14-line `ImageData` stub (lines 3–17). Pattern established.
- `tests/utils/auto-crop.test.ts` — same stub pattern.
- `tests/pipeline/orchestrator.test.ts` — explicitly avoids Workers; the exact pattern a Node inline runner would use.

**Need adapter**
- `tests/utils/image-io.test.ts` — magic-byte sniff tests pass against happy-dom stub File. New tests against sharp adapter for Node.

**Stay browser**
- `tests/components/*.test.ts` — DOM components.
- `tests/infra/coep-policy.test.ts`, `tests/pipeline/model-integrity.test.ts` — browser-runtime assumptions.

**~50 of ~80 test files reusable**. The `ImageData` stub pattern is the only boilerplate.

## Package Layout Options

### Option A — Conditional exports + optional peer deps
One package, one version. Browser/Node split via `package.json` exports:

```json
"exports": {
  ".": { "node": "./dist/node/index.js", "default": "./dist/browser/index.js" },
  "./cli": "./dist/cli/index.js"
}
```

`onnxruntime-web` and `onnxruntime-node` as optional peer deps.

- **Pros**: single repo, single publish, single semver.
- **Cons**: peer-dep friction for CLI users; bundler condition-resolution needs explicit Vite config.
- **Effort**: Medium.

### Option B — npm workspaces monorepo

```
packages/
  nukebg-core/      — pure CV algorithms, ImageDataLike, no ORT
  nukebg-browser/   — core + onnxruntime-web + transformers browser
  nukebg-node/      — core + onnxruntime-node + transformers node
  nukebg-cli/       — nukebg-node + sharp + bin
```

- **Pros**: zero dependency conflicts, independently publishable and testable.
- **Cons**: 4 packages to version/publish; users must install `nukebg-cli` not `nukebg`.
- **Effort**: High.

### Option C — Single repo, CLI bundled binary

One package `nukebg-cli`. Bundled with esbuild/tsup. Bundles `onnxruntime-node` directly. Browser app stays as the existing repo.

- `nukebg-core` stays as a subpath within the same repo, but CLI doesn't publish the browser entry.
- **Pros**: CLI self-contained (`npm install -g nukebg-cli` just works), no peer-dep friction.
- **Cons**: core not shared with browser app via npm (internal only); two publish targets.
- **Effort**: Low–Medium. **Best fit for CLI-first goal.**

## Open Questions for Proposal

1. **ORT strategy**: A (conditional exports) / B (monorepo) / C (bundled CLI). C is simplest for CLI-first.
2. **`ImageData` polyfill**: target Node ≥22 (native) or Node ≥20 (struct stub)? `package.json` declares `"engines": { "node": ">=20.0.0" }`.
3. **SAM refiner in scope?** Adds a third ONNX swap. Likely OUT for v1 CLI.
4. **License disclosure**: RMBG-1.4 = CC-BY-NC-4.0 (non-commercial only). CLI must include prominent license notice and gate commercial use.
5. **Worker-channel adapter**: new `NodePipelineRunner` (calls CV/ML inline) vs. retrofitting "no-op channel" into `WorkerChannel`. The former is cleaner.
6. **`sharp` as direct dep**: currently devDep. CLI needs it as direct dep — adds native binary platform builds.
7. **Pipeline feature parity**: does CLI expose all precision modes (`low`/`normal`/`high`/`ultra`)? Batch mode? `batch-orchestrator.ts` is UI-coupled today.

## Risks

1. `onnxruntime-web` vs `onnxruntime-node` cannot coexist — must pick A/B/C.
2. `ImageData` constructor at 7 semi-pure sites; Node 20 does not expose it natively.
3. RMBG-1.4 = CC-BY-NC-4.0 — CLI cannot be used commercially without BRIA AI license.
4. `import.meta.env.DEV` in orchestrator is Vite-injected; falsy in Node — debug logs won't appear, replace with `process.env.NODE_ENV`.
5. `sharp` is currently devDep; CLI needs it as direct dep with native platform builds.

## Source

- Engram topic key: `sdd/extract-core-cli/explore` (project: nukebg)
- Engram discovery: `nukebg/ort-package-conflict`
