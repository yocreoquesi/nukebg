# nukebg-core

Runtime-agnostic background-removal pipeline: pure CV algorithms, watermark
detection, inpainting, and a pluggable ML orchestrator. No DOM, no Node
built-ins, **zero runtime dependencies**.

`nukebg-core` does not ship a background-removal model or an image codec —
it defines the seams (`RmbgRunner`, `LamaRunner`, `ImageCodec`) and orchestrates
them. You bring the runtime-specific implementations. The browser app in this
monorepo (`nukebg-app`) and the CLI (`nukebg-cli`) are both thin adapters over
this package.

## Install

```bash
npm install nukebg-core
```

Requires Node.js 20+ for the CLI/server use case. In a browser, it is consumed
via a bundler (Vite, esbuild, webpack) — there is no UMD/global build.

## Public API

### Types

| Export | What it is |
| --- | --- |
| `ImageDataLike` | Structural interface (`data`, `width`, `height`, optional `colorSpace`) that both the browser's real `ImageData` and a plain object satisfy. |
| `createImageDataLike(data, width, height)` | Factory that builds a plain `ImageDataLike` object. Use this instead of `new ImageData(...)` — core never touches the DOM `ImageData` constructor. |
| `PipelineMode` | `'photo' \| 'signature' \| 'icon' \| 'auto'` |
| `PipelinePrecision` | `'low' \| 'normal' \| 'high' \| 'ultra'` |
| `PipelineOptions` | `{ mode?, precision?, skipWatermark?, signal?, onStage? }` — input to `runPipeline`. |
| `PipelineResult` | `{ output: ImageDataLike, resolvedMode, durationMs, stageTimings, ... }` — output of `runPipeline`. |
| `PipelineStage`, `StageStatus`, `StageEvent`, `ImageContentType` | Supporting types for progress reporting and result shape. |
| `BgColorResult`, `WatermarkResult`, `ClassifyImageResult`, `ImageFeatures`, `GridResult` | Structured results from the pure CV detection functions. |

### Runner interfaces (the seams you implement)

| Interface | Responsibility |
| --- | --- |
| `PipelineRunner` | `run(input, options) -> PipelineResult`, plus optional `preload()` and `dispose()`. The top-level thing a consumer calls. |
| `RmbgRunner` | Background-removal model adapter. `segment(input, opts) -> Uint8Array` alpha mask. Optional `load()`, required `dispose()`. |
| `LamaRunner` | Inpainting model adapter. `inpaint(input, mask, opts) -> Uint8ClampedArray`. Optional `load()`, required `dispose()`. |
| `ImageCodec` | Byte <-> pixel boundary. `decode(bytes) -> { image, originalWidth, originalHeight, wasDownsampled }`, `encode(image, format) -> Uint8Array`. |

### Orchestrator

| Export | What it is |
| --- | --- |
| `runPipeline(input, runners, options?)` | Runtime-agnostic pipeline: classify -> watermark detect/inpaint -> RMBG segmentation -> composite -> finalize. Calls pure CV functions directly, no Workers, no DOM, no filesystem. |
| `RunnerBundle` | `{ rmbg: RmbgRunner, lama?: LamaRunner }` — the second argument to `runPipeline`. Omit `lama` to fall back to PatchMatch-only inpainting. |

### Error classes

All extend `NukebgError` (itself extends `Error`), so `error instanceof NukebgError`
catches any of them, and `error.code` gives you a stable machine-readable reason.

| Class | Thrown when |
| --- | --- |
| `NukebgError` | Base class. Carries `code` and preserves `cause`. |
| `RmbgError` | The `RmbgRunner` failed (model load, integrity check, segmentation). |
| `LamaError` | The `LamaRunner` failed (download, integrity check, inpainting). |
| `DecodeError` | An `ImageCodec` failed to decode input bytes. |
| `PipelineAbortError` | `options.signal` fired before or during a stage. |

### Pure CV namespace + helpers

`export * as cv` re-exports every pure, dependency-free vision algorithm
(background-color sampling, checkerboard-grid detection, watermark detection,
Telea/PatchMatch inpainting, alpha matting/refinement, and more) for advanced
consumers who want to compose their own pipeline instead of using
`runPipeline`. Also exported at the root: `computeLamaCropRect`,
`bilinearResizeRGBA`, `nearestResizeMask`, `spliceLamaOutput`, `resampleMask`,
`packRgbaToChw`, `packMaskToChw`, `unpackChwToRgba`, `patchMatchInpaint`,
`compareAlpha` (the browser/Node pixel-parity comparison helper), and the
read-only tuning constants (`RMBG_PARAMS`, `LAMA_PARAMS`, `PRECISION_PROFILES`,
etc.) from `pipeline/constants.js`.

## Embedding example: your own Node app

`nukebg-core` never picks a model runtime for you. Here's a minimal
`RmbgRunner`/`LamaRunner` pair backing `runPipeline` in a plain Node script —
this is the same shape `nukebg-cli` uses internally (see
`packages/nukebg-cli/src/runners/`).

```ts
import { readFile, writeFile } from 'node:fs/promises';
import {
  runPipeline,
  createImageDataLike,
  type ImageDataLike,
  type RmbgRunner,
  type RunnerBundle,
} from 'nukebg-core';

// Bring your own model runtime — this is the seam `nukebg-core` leaves open.
class MyRmbgRunner implements RmbgRunner {
  async load(): Promise<void> {
    // e.g. warm up an ONNX session
  }

  async segment(input: ImageDataLike): Promise<Uint8Array> {
    // Run your model, return a width*height alpha mask (0..255)
    return new Uint8Array(input.width * input.height);
  }

  async dispose(): Promise<void> {
    // release the session
  }
}

async function removeBackground(inputPath: string, outputPath: string) {
  const rmbg = new MyRmbgRunner();
  const runners: RunnerBundle = { rmbg }; // omit `lama` to skip watermark inpainting

  // Decode however you like — nukebg-core doesn't ship a codec.
  // Here we assume you already have raw RGBA pixels + dimensions.
  const { data, width, height } = await decodeToRgba(inputPath);
  const input = createImageDataLike(data, width, height);

  const result = await runPipeline(input, runners, { mode: 'auto', precision: 'normal' });

  console.log('resolved mode:', result.resolvedMode, 'took', result.durationMs, 'ms');
  await encodeAndWrite(result.output, outputPath);
}
```

For a complete, production-shaped implementation of the codec + model runners
(sharp for I/O, `@huggingface/transformers` + `onnxruntime-node` for the
models), read the [`nukebg-cli` source](https://github.com/yocreoquesi/nukebg/tree/main/packages/nukebg-cli/src).

## Zero runtime dependencies

`nukebg-core`'s `package.json` declares no runtime `dependencies` — the pure
CV, orchestration, and type layer are hand-written TypeScript with no
external packages. The only things it needs at runtime are whatever you
inject as `RmbgRunner`/`LamaRunner`/`ImageCodec`. This keeps the package
embeddable in both browser bundles and Node servers without dragging in
model-runtime weight you may not want.

## License

GPL-3.0-only for this package's own code. Note that `nukebg-core` itself does
not bundle or depend on the RMBG-1.4 model — that license obligation
(CC-BY-NC-4.0, non-commercial) applies to whichever `RmbgRunner` you inject,
such as the one shipped in
[`nukebg-cli`](https://www.npmjs.com/package/nukebg-cli).
