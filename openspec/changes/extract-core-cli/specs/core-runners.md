# Core Runners Specification

## Purpose

`nukebg-core` defines the runner interfaces that decouple the pipeline algorithm from any specific ML runtime or image I/O library. Implementations live in consumers (`nukebg-cli` for Node, the browser app for the web); the interfaces live in core and form the only bridge between the two worlds.

## Requirements

### REQ-CORE-RUNNERS-1: `RmbgRunner` interface

**Statement**: `nukebg-core` MUST export:

```ts
export interface RmbgRunner {
  segment(image: ImageDataLike): Promise<ImageDataLike>;
  readonly modelId: string;
  readonly modelRevision: string;
}
```

`segment` MUST return an `ImageDataLike` representing the alpha mask (single-channel or RGBA where only the alpha channel is meaningful). Implementations MUST verify model integrity before first use. If verification fails, the implementation MUST reject with an `RmbgError` where `error.code === "RMBG_INTEGRITY_FAILED"`.

#### Scenario: Successful segmentation

- GIVEN a valid `ImageDataLike` containing a subject on a background
- WHEN `runner.segment(image)` resolves
- THEN the returned `ImageDataLike` has the same `width` and `height` as the input
- AND pixels corresponding to the subject have higher alpha values than background pixels

#### Scenario: Model integrity hash mismatch

- GIVEN an `OnnxNodeRmbgRunner` whose cached model file has been corrupted (hash mismatch)
- WHEN `runner.segment(image)` is called
- THEN it rejects with an `RmbgError` where `error.code === "RMBG_INTEGRITY_FAILED"`
- AND the error is NOT silently swallowed or retried

#### Scenario: Model download fails

- GIVEN the model is not cached and the network is unreachable
- WHEN `runner.segment(image)` is called for the first time
- THEN it rejects with an `RmbgError` where `error.code === "RMBG_DOWNLOAD_FAILED"`

---

### REQ-CORE-RUNNERS-2: `LamaRunner` interface

**Statement**: `nukebg-core` MUST export:

```ts
export interface LamaRunner {
  inpaint(image: ImageDataLike, mask: ImageDataLike): Promise<ImageDataLike>;
  readonly modelId: string;
}
```

`inpaint` receives the full image and a binary mask (non-zero pixels = regions to inpaint). The returned `ImageDataLike` MUST have the same dimensions as `image`. If the model fetch fails after all retries, the implementation MUST reject with a `LamaError` where `error.code === "LAMA_DOWNLOAD_FAILED"`.

#### Scenario: Successful inpainting

- GIVEN an image with a watermark region and a corresponding mask
- WHEN `runner.inpaint(image, mask)` resolves
- THEN the returned image has the watermark region filled plausibly
- AND the output dimensions match the input dimensions exactly

#### Scenario: Model fetch fails after retries

- GIVEN the LaMa ONNX model is not cached and every HTTP attempt fails
- WHEN `runner.inpaint(image, mask)` is called
- THEN it rejects with a `LamaError` where `error.code === "LAMA_DOWNLOAD_FAILED"`
- AND the rejection propagates to `runPipeline` which wraps it in a `LamaError` with `cause` preserved

#### Scenario: `LamaRunner` is `null` when `skipWatermark: true`

- GIVEN `runPipeline` is called with `skipWatermark: true` and `runners.lama === null`
- WHEN the pipeline executes
- THEN the inpaint stage is skipped entirely with no error
- AND the output is produced without calling any `LamaRunner` method

---

### REQ-CORE-RUNNERS-3: `ImageCodec` interface

**Statement**: `nukebg-core` MUST export:

```ts
export interface ImageCodec {
  decode(input: Uint8Array): Promise<ImageDataLike>;
  encode(image: ImageDataLike, format: "png" | "webp"): Promise<Uint8Array>;
}
```

`decode` MUST accept raw bytes of a PNG, JPEG, or WebP image. `encode` MUST produce valid bytes for the requested format. If the input bytes are not a recognized image format, `decode` MUST reject with a `DecodeError` where `error.code === "DECODE_FAILED"`.

#### Scenario: Decoding a valid PNG

- GIVEN a `Uint8Array` containing the bytes of a valid PNG file
- WHEN `codec.decode(bytes)` resolves
- THEN the result is an `ImageDataLike` with correct `width`, `height`, and four-channel (RGBA) `data`

#### Scenario: Decoding an invalid file

- GIVEN a `Uint8Array` containing arbitrary non-image bytes
- WHEN `codec.decode(bytes)` is called
- THEN it rejects with a `DecodeError` where `error.code === "DECODE_FAILED"`

#### Scenario: Encoding to PNG preserves alpha

- GIVEN an `ImageDataLike` with transparent pixels (alpha = 0 in some regions)
- WHEN `codec.encode(image, "png")` resolves
- THEN the returned `Uint8Array` starts with the PNG magic bytes (`0x89 0x50 0x4E 0x47`)
- AND re-decoding the bytes produces an image where the same pixels have `alpha = 0`

---

### REQ-CORE-RUNNERS-4: `PipelineRunner` interface

**Statement**: `nukebg-core` MUST export:

```ts
export interface PipelineRunner {
  run(
    input: ImageDataLike,
    options: PipelineOptions,
    signal?: AbortSignal,
  ): Promise<PipelineResult>;
}
```

This interface is implemented by `WorkerPipelineRunner` (browser app) and `NodePipelineRunner` (CLI). Both MUST produce outputs that are pixel-equivalent within the defined parity epsilon (see `browser-app-parity.md`).

#### Scenario: Runner contract satisfied by Node implementation

- GIVEN a `NodePipelineRunner` is instantiated with valid `RmbgRunner`, `LamaRunner`, and `ImageCodec`
- WHEN `runner.run(image, options)` is called
- THEN it fulfills the same contract as `runPipeline` called directly with the same arguments

#### Scenario: Runner contract satisfied by browser implementation

- GIVEN a `WorkerPipelineRunner` is used in the browser app
- WHEN `runner.run(image, options)` is called
- THEN it delegates to Web Workers but ultimately resolves with a `PipelineResult` satisfying the same interface

---

### REQ-CORE-RUNNERS-5: Typed error hierarchy

**Statement**: All runner-level errors MUST extend a base `NukebgError` class exported from `nukebg-core`. Every error MUST carry a `code: string` property (see the table in `core-pipeline.md` REQ-CORE-PIPELINE-4). Errors MUST NOT be plain `Error` instances. Implementations MUST preserve the original cause via `{ cause: originalError }`.

#### Scenario: Error identity check

- GIVEN `runPipeline` rejects
- WHEN the caller checks `error instanceof NukebgError`
- THEN the result is `true` regardless of which stage failed

#### Scenario: Error cause is accessible

- GIVEN an `OnnxNodeRmbgRunner` that internally catches an onnxruntime exception
- WHEN the runner rejects with an `RmbgError`
- THEN `error.cause` holds the original onnxruntime exception
- AND `error.code === "RMBG_FAILED"`
