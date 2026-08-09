# Browser/Node Pipeline Parity Specification

## Purpose

The extraction must not silently change the visual output. This spec defines the contract that ensures the existing browser pipeline (`WorkerPipelineRunner`) and the new Node pipeline (`NodePipelineRunner`) produce pixel-equivalent results for a fixed fixture set. It also asserts that the existing browser app continues to function correctly after the workspace refactor.

## Requirements

### REQ-PARITY-1: Pixel equivalence on the fixture set

**Statement**: For each image in the designated fixture set (see below), running the pipeline through `WorkerPipelineRunner` (browser) and `NodePipelineRunner` (Node) with identical options MUST produce alpha-channel values that differ by at most **ε = 2** per pixel on an 8-bit scale (0–255). RGB channel values in non-transparent regions MUST be identical (ε = 0, since they pass through lossless compositing).

**Fixture set** (stored under `packages/nukebg-core/tests/fixtures/parity/`):

| Filename | Description |
|---|---|
| `portrait-512x512.png` | Human portrait, white background |
| `product-800x600.jpg` | Product photo with watermark |
| `logo-256x256.png` | Icon/logo, transparent background |

**Rationale for ε = 2**: RMBG-1.4 uses floating-point ONNX inference; rounding behavior of `onnxruntime-web` (WASM) vs. `onnxruntime-node` (native) may produce 1-LSB differences on edge pixels. An epsilon of 2 tolerates that without masking genuine divergence.

#### Scenario: Alpha channel matches within epsilon for portrait fixture

- GIVEN `portrait-512x512.png` is processed by both runners with `mode: "photo"`, `precision: "normal"`, `skipWatermark: true`
- WHEN the alpha channels of both outputs are compared pixel-by-pixel
- THEN the absolute difference between corresponding alpha values MUST be ≤ 2 for every pixel
- AND the number of pixels where the difference is > 0 MUST be < 5% of total pixels

#### Scenario: Alpha channel matches within epsilon for product fixture with watermark

- GIVEN `product-800x600.jpg` is processed by both runners with `mode: "photo"`, `precision: "normal"`, `skipWatermark: false`
- WHEN the alpha channels of both outputs are compared pixel-by-pixel
- THEN the absolute difference between corresponding alpha values MUST be ≤ 2 for every pixel

#### Scenario: RGB channels are lossless

- GIVEN any fixture from the fixture set is processed by either runner
- WHEN the RGB channels of subject pixels (alpha > 0 in both outputs) are compared
- THEN the values MUST be identical (difference = 0)

---

### REQ-PARITY-2: `WorkerPipelineRunner` remains the browser entrypoint

**Statement**: After the workspace refactor, the browser app MUST continue to import its pipeline runner through the same internal path it used before. The `WorkerPipelineRunner` class MUST still exist in the browser app package. No change to the `PipelineRunner` interface in `nukebg-core` MUST cause a type error in the browser app without a corresponding fix in the same PR.

#### Scenario: Browser app builds after refactor

- GIVEN the workspace conversion is applied
- WHEN `npm run build` is executed inside `packages/nukebg-app` (or the root if app stays at root)
- THEN the build succeeds with zero TypeScript errors

#### Scenario: `WorkerPipelineRunner` satisfies `PipelineRunner`

- GIVEN the `PipelineRunner` interface is imported from `nukebg-core`
- WHEN `WorkerPipelineRunner` is instantiated and assigned to a `PipelineRunner` variable
- THEN TypeScript strict mode accepts the assignment without error

---

### REQ-PARITY-3: Browser visual regression — existing component tests pass

**Statement**: All existing component tests (`tests/components/ar-*.test.ts`) MUST continue to pass after the workspace refactor with no changes to their test code. If a test needs updating solely because of a module path change (not logic), the path update is considered a mechanical fix and not a regression.

#### Scenario: Component tests pass post-refactor

- GIVEN the workspace is converted and `nukebg-core` is published locally via workspace links
- WHEN `npm test` is run in the browser app package
- THEN all component tests exit green with zero failures

---

### REQ-PARITY-4: Parity test is automated and runs in CI

**Statement**: The parity test MUST be an automated test in `packages/nukebg-core/tests/parity/` that runs under the same test runner (vitest) used by the rest of the project. The test MUST NOT require a browser runtime — it MUST run entirely in Node using `NodePipelineRunner` against pre-computed reference outputs from the browser runner. Reference outputs MUST be committed to the repo as PNG files alongside the input fixtures. The test is allowed to be skipped locally with a clear message if the RMBG model is not cached (model download is slow), but MUST NOT be skipped in CI.

#### Scenario: Parity test runs in CI with cached models

- GIVEN the CI environment has the RMBG and LaMa models pre-cached (via CI cache key)
- WHEN the parity test suite executes
- THEN all three fixture comparisons pass within the epsilon threshold
- AND the test exits with code 0

#### Scenario: Parity test skipped locally without cached model

- GIVEN the developer runs `npm test` locally and the RMBG model is not in cache
- WHEN the parity test file is reached
- THEN the test is skipped with the message `"Skipping parity test — RMBG model not cached (set NUKEBG_PARITY_REQUIRE=1 to force)"`
