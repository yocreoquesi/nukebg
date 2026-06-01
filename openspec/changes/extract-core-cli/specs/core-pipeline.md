# Core Pipeline Specification

## Purpose

`nukebg-core` owns the runtime-agnostic pipeline that segments the subject from a background image. It receives pixel data and runner implementations and returns processed pixel data. It has no knowledge of the file system, the DOM, Workers, or any specific ML runtime.

## Requirements

### REQ-CORE-PIPELINE-1: `runPipeline` function signature and contract

**Statement**: `nukebg-core` MUST export a top-level async function `runPipeline` with the following shape:

```ts
export async function runPipeline(
  input: ImageDataLike,
  runners: PipelineRunners,
  options: PipelineOptions,
  signal?: AbortSignal,
): Promise<PipelineResult>
```

`PipelineRunners` MUST contain `rmbg: RmbgRunner`, `lama: LamaRunner | null`, and `codec: ImageCodec`. `PipelineOptions` MUST contain `mode`, `precision`, `skipWatermark`, and `skipAutoCrop`. The function MUST be pure with respect to global state — concurrent calls MUST NOT interfere with each other.

#### Scenario: Happy path — photo with watermark

- GIVEN a PNG image loaded as `ImageDataLike` (subject on a background, visible watermark)
- WHEN `runPipeline` is called with `mode: "photo"`, `precision: "normal"`, `skipWatermark: false`, `skipAutoCrop: false`
- THEN it resolves with a `PipelineResult` containing `output: ImageDataLike` where background pixels have `alpha = 0` and subject pixels have `alpha > 0`
- AND the watermark region is inpainted before segmentation

#### Scenario: No-watermark path

- GIVEN a clean image with no watermark
- WHEN `runPipeline` is called with `skipWatermark: true`
- THEN the LaMa runner is never invoked and the result is produced solely by the RMBG runner

#### Scenario: `mode: "auto"` delegates to classifier

- GIVEN an image whose content type is ambiguous
- WHEN `runPipeline` is called with `mode: "auto"`
- THEN the pipeline MUST invoke the content classifier to resolve the mode to one of `photo | signature | icon` before selecting precision parameters
- AND the resolved mode MUST be reflected in `PipelineResult.resolvedMode`

---

### REQ-CORE-PIPELINE-2: `ImageDataLike` interface

**Statement**: `nukebg-core` MUST export the following interface as its canonical pixel-data contract:

```ts
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}
```

All core functions MUST accept and return `ImageDataLike`. The browser's native `ImageData` MUST satisfy this interface structurally without any adapter. No function in `nukebg-core` MUST reference the global `ImageData` constructor.

#### Scenario: Browser `ImageData` passed as `ImageDataLike`

- GIVEN a browser environment where `ImageData` is constructed natively
- WHEN that `ImageData` instance is passed to any `nukebg-core` function accepting `ImageDataLike`
- THEN no type error occurs and the function processes the data correctly

#### Scenario: Plain object used as `ImageDataLike` in Node

- GIVEN a Node environment where `{ data: Uint8ClampedArray, width: number, height: number }` is produced by `SharpImageCodec`
- WHEN that plain object is passed to `runPipeline`
- THEN it is accepted without conversion and the result is identical to passing a browser `ImageData` with the same pixel data

---

### REQ-CORE-PIPELINE-3: Cancellation via `AbortSignal`

**Statement**: `runPipeline` MUST accept an optional `AbortSignal`. If the signal fires before the pipeline completes, `runPipeline` MUST reject with an `AbortError` (`name === "AbortError"`). The abort MUST be checked at each major stage boundary (after decode, after watermark, after RMBG, after inpaint, after finalize). Already-started long-running ML inference within a single stage MAY complete before the abort is honored at the next boundary.

#### Scenario: Abort before RMBG starts

- GIVEN `runPipeline` is called and the watermark stage completes
- WHEN the `AbortSignal` fires before the RMBG runner is invoked
- THEN the promise rejects with an error where `error.name === "AbortError"`
- AND the RMBG runner is never called

#### Scenario: No signal provided — pipeline runs to completion

- GIVEN `runPipeline` is called with no `AbortSignal` argument
- WHEN the pipeline runs normally
- THEN it resolves with a valid `PipelineResult` regardless of any external cancellation mechanism

---

### REQ-CORE-PIPELINE-4: Typed error modes

**Statement**: `runPipeline` MUST NOT throw generic `Error` objects. All rejections MUST use discriminated error types exported from `nukebg-core`:

| Error class | `code` value | When thrown |
|---|---|---|
| `RmbgError` | `"RMBG_FAILED"` | RMBG runner signals failure |
| `LamaError` | `"LAMA_FAILED"` | LaMa runner signals failure |
| `DecodeError` | `"DECODE_FAILED"` | Codec cannot decode input |
| `PipelineAbortError` | `"PIPELINE_ABORTED"` | AbortSignal fired |

#### Scenario: RMBG runner throws

- GIVEN an `RmbgRunner` that rejects for any reason
- WHEN `runPipeline` processes an image
- THEN the pipeline rejects with an `RmbgError` instance
- AND `error.code === "RMBG_FAILED"` and `error.cause` holds the original runner error

---

### REQ-CORE-PIPELINE-5: Pure pipeline stages

**Statement**: Each pipeline stage function (watermark detection, alpha matting, finalize composite, auto-crop) MUST be exported individually from `nukebg-core` in addition to the `runPipeline` orchestrator. Stage functions MUST be deterministic: identical input MUST produce identical output. Stage functions MUST NOT read or write the file system or make network calls.

#### Scenario: Stage function called in isolation

- GIVEN the `autoFinalizeComposite` function is imported from `nukebg-core`
- WHEN called with a known `ImageDataLike` and a mask
- THEN it returns the composited result without side effects

---

### REQ-CORE-PIPELINE-6: `PipelineResult` shape

**Statement**: `runPipeline` MUST resolve with an object that satisfies:

```ts
export interface PipelineResult {
  readonly output: ImageDataLike;
  readonly resolvedMode: "photo" | "signature" | "icon";
  readonly durationMs: number;
  readonly stageTimings: Record<string, number>;
}
```

`durationMs` MUST be the wall-clock time from function entry to resolution. `stageTimings` MUST contain at least the keys `"watermark"`, `"rmbg"`, `"inpaint"`, `"finalize"`.

#### Scenario: Result contains timing data

- GIVEN `runPipeline` resolves successfully
- WHEN the caller reads `result.stageTimings`
- THEN all four required keys are present and each value is a non-negative number in milliseconds
