# Proposal — extract-core-cli

## Why

nukebg's CV+ML pipeline (RMBG segmentation, watermark detection, LaMa inpainting, checkerboard nuking) is high-value IP currently locked inside a browser app. A Node CLI unlocks scripted/headless use cases (CI image processing, batch jobs, integration with non-browser tooling) using the SAME pipeline code, not a parallel reimplementation. CLI-first (vs MCP) because: (a) a CLI is the smallest viable surface that proves the extraction works, (b) MCP servers can wrap a CLI later for ~zero added cost, (c) every MCP host already knows how to spawn a CLI, so we ship value faster while keeping MCP as a clean follow-up.

## What Changes

- Introduce **`nukebg-core`** package — pure TypeScript library with all CV algorithms, pipeline orchestration as a runtime-agnostic flow, and an `ImageDataLike` data contract. No ORT, no DOM, no Worker imports.
- Introduce **`nukebg-cli`** package — Node-only binary. Depends on `nukebg-core`, `onnxruntime-node`, `@huggingface/transformers` (Node mode), `sharp`, `commander`. Ships a `nukebg` bin.
- Convert the repo to an **npm workspaces monorepo** (`packages/nukebg-core`, `packages/nukebg-cli`, plus the existing browser app moved to `packages/nukebg-app` or kept at root consuming core via workspace).
- Move all pure CV modules (`src/workers/cv/*`) into `nukebg-core` unchanged.
- Refactor `ImageData` constructor sites to accept/produce `ImageDataLike` (`{ data: Uint8ClampedArray; width: number; height: number }`). Browser keeps using real `ImageData` (structurally compatible).
- Extract a `PipelineRunner` interface from the current orchestrator. Browser keeps the Worker-backed runner; Node ships a new `NodePipelineRunner` that calls CV/ML inline (no Workers, no postMessage).
- Port ML loaders to a runtime-pluggable shape: a `RmbgRunner` and `LamaRunner` interface in core, a browser implementation using `onnxruntime-web` and a Node implementation using `onnxruntime-node`. Workers stay browser-only.
- Surface the RMBG-1.4 CC-BY-NC-4.0 license gate in the CLI on first run.
- Defer SAM, MobileSAM editor, batch UI, advanced editor, and i18n out of v1.

## Decisions

### 1. Package Layout: Two-package monorepo (`nukebg-core` + `nukebg-cli`), browser app consumes core

**Choice**: Convert to npm workspaces with two new packages: `nukebg-core` (pure library, zero runtime deps on ORT) and `nukebg-cli` (Node binary). The existing browser app keeps working by importing from `nukebg-core` via workspace link; its bundler-specific code (Workers, Vite-injected globals) stays in the app, not in core.

**Rationale**:
- The `onnxruntime-web` ↔ `onnxruntime-node` conflict is the dominant constraint. The cleanest way to dodge it is to keep ORT OUT of `nukebg-core` entirely — core defines runner interfaces, each package wires its own ORT.
- Two packages, not four. Exploration's Option B (4 packages: core + browser + node + cli) is over-engineered for v1 — the browser already has a host (the existing app), and the Node "library" only has one consumer (the CLI), so we collapse them.
- Conditional exports (Option C from exploration) leak both ORT flavors into one package's metadata and confuse Vite/bundlers. We avoid that whole class of bug by keeping ORT out of the public package.
- Workspace setup is a one-time cost; CI already runs npm scripts, so the change is contained.

**Rejected alternatives**:
- *Conditional exports in a single package*: ORT conflict resurfaces as an installer/peer-dep puzzle for downstream consumers. No.
- *4-package monorepo*: extra version churn for `nukebg-browser` and `nukebg-node` that have one consumer each. Premature.
- *Separate repos*: loses single-source-of-truth for CV code, doubles release pain.

**Migration cost**: Medium. Mostly file moves + `package.json` splits + a workspace root. No algorithm changes. Existing `tests/cv/*` follow the code into `nukebg-core/tests` with zero edits.

### 2. Core Boundary

**Goes into `nukebg-core` (pure, no DOM, no ORT, no Workers)**:
- All of `src/workers/cv/*` (20 files: telea, otsu, alpha-matting, watermark detection, color-utils, etc.).
- `src/workers/cv/utils.ts` (math helpers).
- `src/pipeline/constants.ts`.
- `src/pipeline/finalize.ts`, `finalize-result.ts` — refactored to use `ImageDataLike`.
- `src/utils/final-composite.ts`, `src/utils/auto-crop.ts` — refactored to `ImageDataLike`.
- The pure inner of `src/workers/inpaint.worker.ts` (the `patchMatchInpaint` function only — strip the `self.postMessage` shell).
- New: `ImageDataLike` interface, `PipelineRunner` interface, `RmbgRunner` interface, `LamaRunner` interface, `ImageCodec` interface.
- New: a runtime-agnostic `runPipeline(input: ImageDataLike, runners, options)` function that today's orchestrator's algorithm collapses into.

**Stays browser-only (in the app, NOT in core)**:
- `src/pipeline/orchestrator.ts` (Worker spawning, `import.meta.env.DEV`).
- `src/pipeline/worker-channel.ts` (postMessage protocol).
- `src/workers/ml.worker.ts`, `lama.worker.ts`, `sam.worker.ts`, `inpaint.worker.ts`, `cv.worker.ts` — Worker shells.
- `src/utils/image-io.ts` (createImageBitmap / OffscreenCanvas).
- All `src/components/ar-*.ts` (custom elements).
- Service worker, Vite config, `import.meta.env` references.

**New in `nukebg-cli` (Node-only adapters)**:
- `SharpImageCodec` — implements `ImageCodec`, decodes via `sharp().raw().toBuffer()`, encodes via `sharp({raw}).png/.webp`.
- `OnnxNodeRmbgRunner` — uses `@huggingface/transformers` Node mode + `onnxruntime-node`.
- `OnnxNodeLamaRunner` — uses `onnxruntime-node` directly.
- `NodePipelineRunner` — calls CV functions inline, no Workers.
- `cli.ts` — `commander`-based entrypoint, license gate, progress reporting.
- License-gate state stored in OS config dir (e.g., `~/.config/nukebg/accepted-license.json` via `env-paths`).

### 3. ImageData Strategy: `ImageDataLike` interface in core

**Choice**: Define in `nukebg-core`:
```ts
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}
```
All core functions accept and return `ImageDataLike`. Browser passes real `ImageData` (it satisfies the interface structurally). Node passes plain objects from sharp.

**Rationale**:
- Keeps Node engine floor at the current `>=20.0.0`. Real `ImageData` as a Node global only landed in 22, and even there it's behind `--experimental-global-webcrypto`-class flags depending on minor version. Bumping to 22 to support a CLI is a regression for browser-app contributors who don't need it.
- Avoids `canvas` npm package: native bindings, slow installs, breaks on musl/alpine without extra work.
- Structural typing means the browser app keeps working with zero changes — `ImageData` satisfies `ImageDataLike` for free.
- Tests: existing happy-dom polyfill stub (already in `tests/utils/final-composite.test.ts`) becomes unnecessary in core because tests can construct plain objects.

**Rejected**:
- *Require Node 22*: bumps engines floor unnecessarily for a single feature we can polyfill with a 4-line interface.
- *`canvas` npm package*: heavy native dep, deployment friction, transitive surface area.
- *Polyfill `ImageData` global in Node*: monkey-patches globals, surprising behavior.

### 4. Pipeline Runner: New `NodePipelineRunner` (inline), no Worker retrofit

**Choice**: Add a small `PipelineRunner` interface in core. Browser keeps `WorkerPipelineRunner` (today's `PipelineOrchestrator` + `WorkerChannel`). Node ships `NodePipelineRunner` that calls the CV pure functions and ML runners directly with `await`, no postMessage.

**Rationale**:
- Exploration explicitly notes the orchestrator unit test ALREADY mocks the Worker boundary and calls CV functions directly — that test pattern IS the inline runner's shape. We're just promoting an existing pattern to first-class.
- A "no-op channel" retrofit would force us to keep `postMessage` semantics, transferable buffers, and the request-correlation map alive in Node for zero benefit. It also makes Node debugging worse (stack traces cross a fake channel).
- Inline runner is ~150 lines vs. retrofitting ~600 lines of channel infrastructure.
- Node CLIs don't benefit from off-main-thread work the way browsers do; the CLI is the only thing on the event loop.

**Rejected**:
- *No-op WorkerChannel adapter*: extra abstraction, no benefit, harder to debug.
- *`worker_threads` in Node*: real parallelism but unnecessary for v1 (single-image processing). Possible future opt-in.

### 5. v1 Scope

**In v1**:
- Single-image background removal (RMBG-1.4 via `@huggingface/transformers` + `onnxruntime-node`).
- Watermark detection + LaMa inpainting (mirrors the existing browser flow).
- Checkerboard "nuke" fallback (already pure CV, free).
- Auto-crop, alpha matting, finalize composite — all already pure.
- Output: PNG with alpha, WebP with alpha. Input: PNG, JPEG, WebP via sharp.
- Modes: `photo | signature | icon | auto` (matches existing classifier output).
- Precision: `low | normal | high | ultra` (matches existing precision tiers).

**Out of v1** (deferred):
- MobileSAM interactive refinement — interactive UX makes no sense in a CLI without a separate review step.
- Editor UI.
- Batch processing across directories (v1.1 follow-up).
- i18n of CLI strings (English-only v1).
- Advanced editor features.
- Service worker / offline cache reuse.
- MCP server wrapper.

**Reasoning**: v1 must prove the extraction works end-to-end on the most-used path. RMBG + watermark removal IS that path. Everything else is incremental once the seam is solid.

### 6. License Gate

RMBG-1.4 is CC-BY-NC-4.0. The CLI MUST NOT silently enable commercial use. Four layers:

1. **README banner** in `nukebg-cli`: prominent "NON-COMMERCIAL USE ONLY (RMBG-1.4 license)" notice with link to BRIA AI's commercial-license contact.
2. **First-run interactive acknowledgement**: on first invocation, the CLI prints the license summary and asks `Do you accept non-commercial use? [y/N]`. On `y`, write `<config-dir>/nukebg/accepted-license.json` with `{ version: 1, acceptedAt: <ISO>, acknowledged: "RMBG-1.4 CC-BY-NC-4.0" }`. On `N` or non-TTY without override, exit non-zero with a clear message.
3. **Scripted opt-in flag**: `--accept-non-commercial` makes the CLI runnable in CI/non-interactive contexts. Same effect as answering `y`.
4. **`nukebg license` subcommand**: prints the full license text and acceptance status; `nukebg license --revoke` removes the marker.

**Rationale**: README-only is too weak. Refusing to start without acknowledgement is the bar courts care about for CC-BY-NC enforcement. The flag form makes scripting explicit — if it's in your CI script, you've made a deliberate choice.

### 7. CLI Surface (sketch)

```
nukebg <input> [options]
nukebg license [--revoke]
nukebg --version
nukebg --help

Positional:
  input                 Path to input image (PNG / JPEG / WebP). Use "-" to read from stdin.

Options:
  -o, --output <path>           Output path. Default: <input-stem>.nukebg.png. Use "-" for stdout.
  -f, --format <png|webp>       Output format. Default: png.
  --mode <photo|signature|icon|auto>   Pipeline mode. Default: auto.
  --precision <low|normal|high|ultra>  Precision tier. Default: normal.
  --no-watermark                Skip watermark detection + inpainting.
  --no-auto-crop                Skip auto-crop step.
  --cache-dir <path>            Override model cache directory. Default: $TRANSFORMERS_CACHE or OS cache dir.
  --accept-non-commercial       Acknowledge RMBG-1.4 CC-BY-NC-4.0 (required for CI / non-TTY).
  --json                        Emit machine-readable progress + result on stdout (when -o is a file).
  -q, --quiet                   Suppress progress output.
  -v, --verbose                 Verbose logs (model load timings, per-stage durations).
  -h, --help
  --version
```

**Notes**:
- v1 is single-image. Batch is v1.1.
- `--json` mode is for tooling integration (line-delimited JSON events). May degrade to v1.1 if it complicates testing.
- No `--device gpu` flag in v1: `onnxruntime-node` CPU only initially.

### 8. Distribution

**Choice**: Publish two packages to npm:
- `nukebg-core` — public, library, GPL-3.0-only.
- `nukebg-cli` — public, ships the `nukebg` bin via `package.json#bin`.

The existing `nukebg` browser-app package stays `private: true` and gets renamed to `nukebg-app` (still private). It depends on `nukebg-core` via workspace.

**Rationale**:
- `nukebg-cli` is the discoverable name (`npm i -g nukebg-cli`, then `nukebg <input>`).
- Reusing the bare `nukebg` package name for the CLI conflicts with what users may search for as "the nukebg library". Splitting names removes ambiguity.
- The browser app package staying private is correct — it's not for npm consumption.
- License: `nukebg-core` and `nukebg-cli` inherit GPL-3.0-only, but the README of `nukebg-cli` documents that running with the default RMBG-1.4 model requires non-commercial use due to the MODEL license, separate from the code license.

## Affected Modules

| Path | Action |
|------|--------|
| `src/workers/cv/*.ts` (20 files) | move → `packages/nukebg-core/src/cv/` |
| `src/workers/cv/utils.ts` | move → `packages/nukebg-core/src/cv/utils.ts` |
| `src/pipeline/constants.ts` | move → `packages/nukebg-core/src/pipeline/constants.ts` |
| `src/pipeline/finalize.ts` | port (`new ImageData(...)` → `ImageDataLike` factory) → core |
| `src/pipeline/finalize-result.ts` | port → core |
| `src/utils/final-composite.ts` | port → core |
| `src/utils/auto-crop.ts` | port → core |
| `src/workers/inpaint.worker.ts` | split: pure `patchMatchInpaint` → core; Worker shell stays in app |
| `src/pipeline/orchestrator.ts` | refactor: extract algorithm into `runPipeline()` in core; Worker spawning stays in app as `WorkerPipelineRunner` |
| `src/pipeline/worker-channel.ts` | unchanged, stays in app |
| `src/workers/ml.worker.ts` | unchanged in browser app; CLI uses `OnnxNodeRmbgRunner` |
| `src/workers/lama.worker.ts` | unchanged in browser app; CLI uses `OnnxNodeLamaRunner` |
| `src/workers/sam.worker.ts` | unchanged (out of v1 scope) |
| `src/workers/cv.worker.ts` | unchanged in browser app |
| `src/utils/image-io.ts` | unchanged in browser app; CLI uses `SharpImageCodec` |
| `src/utils/capability-detector.ts` | unchanged (typeof guards already Node-safe) |
| `src/components/ar-*.ts` | unchanged |
| `tests/cv/**`, `tests/workers/cv/**` | move to `packages/nukebg-core/tests/` |
| `tests/utils/{final-composite,auto-crop}.test.ts` | move to core |
| `tests/utils/image-io.test.ts` | unchanged (browser); CLI gets new tests for `SharpImageCodec` |
| `tests/pipeline/**` | partially move (algorithm tests → core); Worker-shell tests stay in app |
| `tests/components/**` | unchanged |
| New: `packages/nukebg-core/src/runners/{ImageCodec,RmbgRunner,LamaRunner,PipelineRunner}.ts` | new interfaces |
| New: `packages/nukebg-cli/src/{cli.ts,sharp-codec.ts,onnx-node-rmbg.ts,onnx-node-lama.ts,node-pipeline-runner.ts,license-gate.ts}` | new |
| `package.json` (root) | add `workspaces` |
| `packages/nukebg-core/package.json` | new |
| `packages/nukebg-cli/package.json` | new — declares `bin: { nukebg: "./dist/cli.js" }` |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `@huggingface/transformers` Node mode behaves differently from browser mode for RMBG-1.4 | Medium | High | Smoke test: process the same fixture image in browser and Node, diff alpha channel byte-for-byte. Spec MUST define this acceptance test. |
| `onnxruntime-node` ABI breakage on certain platforms (Windows ARM, musl/alpine) | Medium | Medium | Document supported platforms in README; CI matrix tests Linux x64, macOS arm64, Windows x64. Defer alpine to v1.x. |
| `sharp` install pain on exotic platforms | Low | Medium | sharp is already a devDep — known good. Document `--platform` install hints. |
| Workspaces setup breaks existing `npm test`, `npm run dev`, GitHub Actions | High at first | High initially | Pin workspace migration to a single PR with full CI run. Keep root scripts routed via `npm test --workspaces` plus app-specific. |
| `ImageDataLike` refactor introduces subtle bugs at every `new ImageData(...)` site | Medium | Medium | TypeScript strict mode catches signature mismatches; existing tests exercise these sites. Strict TDD: add tests BEFORE refactoring each site. |
| RMBG model cache divergence between browser (Cache API) and Node (filesystem) | Low | Low | Document; offer `--cache-dir` for users who want to share with `transformers`-Python cache. |
| CC-BY-NC enforcement is novel for a CLI; legally fragile | Low | High | Layered gate (README + interactive + flag + status command). |
| Worker vs. inline pipeline output parity is implicit, not enforced | Medium | Medium | Spec should require a parity test running same pipeline through both runners against a fixed input, asserting pixel equality within epsilon. |

## Rollback Plan

1. **Pre-merge phases**: revert the workspaces commit, `packages/*` deleted, `src/` returns to current shape. Cost: zero.
2. **Post-merge, pre-publish**: keep monorepo, suspend `nukebg-cli` publish. Browser app still works via local workspace link. Cost: monorepo overhead without CLI payoff. Bridge state.
3. **Post-publish**: deprecate `nukebg-cli` on npm with a deprecation message pointing to the open issue. Keep `nukebg-core` (still useful internally).

The expensive irreversible steps are: (a) workspace conversion, (b) `ImageDataLike` refactor in `finalize.ts` / `final-composite.ts`. Both are done early in the apply phase so a rollback decision is cheap.

## Out of Scope

- **MCP server**: separate change, can wrap `nukebg-cli` as a subprocess later.
- **MobileSAM interactive refinement**: no sensible CLI UX without a review loop.
- **Batch processing** (`nukebg ./*.jpg`): v1.1.
- **Editor UI / brush / lasso / undo stack**: this is a UI.
- **i18n of CLI strings**.
- **GPU execution provider** for `onnxruntime-node`.
- **Service Worker / offline mode reuse**.
- **`worker_threads` in Node**.
- **Renaming the existing browser app's npm name to something public**.
- **Switching repo license**: stays GPL-3.0-only.
- **Publishing the browser app to npm**.

## Open Questions for Spec Phase

1. **Output filename default**: `<stem>.nukebg.png` vs `<stem>-nobg.png` vs `<stem>.cutout.png`?
2. **Stdin/stdout streaming**: support `-` for both? What format on stdin (raw PNG bytes)?
3. **Progress reporting format**: human-readable vs `--json` line-delimited events. Event shape?
4. **Mode `auto` classifier**: ship the classifier (extra ML model) or default `auto` to `photo` and let users override?
5. **Exit codes**: contract? `0` success, `1` user error, `2` license-not-accepted, `3` model-download-failed, `4` decode-failed, `5` pipeline-failed?
6. **Logging**: stderr vs stdout for progress? `--json` redirects machine output where?
7. **Model version pinning**: today `RMBG_PARAMS.PIN` pins a HF revision. Does CLI expose `--rmbg-revision` or hard-pin?
8. **`@huggingface/transformers` v3 vs v4**: confirm Node + browser support parity.
9. **Test parity**: define exact fixture images and tolerance epsilon for browser↔Node parity test.
10. **Workspace boundary for tests**: one root `vitest` config or one per package?
