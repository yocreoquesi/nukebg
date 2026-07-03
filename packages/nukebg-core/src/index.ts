// nukebg-core public API — populated in Phase 3+

// Types
export type { ImageDataLike } from './types/image-data-like.js';
export { createImageDataLike } from './types/image-data-like.js';
export type { PipelineMode, PipelinePrecision, PipelineOptions } from './types/pipeline-options.js';
export type {
  PipelineResult,
  PipelineStage,
  StageStatus,
  StageEvent,
  ImageContentType,
} from './types/pipeline-result.js';
export type {
  BgColorResult,
  WatermarkResult,
  ClassifyImageResult,
  ImageFeatures,
  GridResult,
} from './types/cv-results.js';

// Runner interfaces — the runtime seams
export type { PipelineRunner } from './runners/pipeline-runner.js';
export type { RmbgRunner, RmbgRefineOptions } from './runners/rmbg-runner.js';
export type { LamaRunner } from './runners/lama-runner.js';
export type { ImageCodec, EncodeFormat } from './runners/image-codec.js';

// Error classes
export {
  NukebgError,
  RmbgError,
  LamaError,
  DecodeError,
  PipelineAbortError,
} from './pipeline/errors.js';

// Top-level pipeline orchestrator + runner bundle type
export { runPipeline } from './pipeline/run-pipeline.js';
export type { RunnerBundle } from './pipeline/run-pipeline.js';

// Pure CV functions — public for advanced consumers, also used by the app's WorkerPipelineRunner
export * as cv from './cv/index.js';

// LaMa crop/resize/splice helpers — re-exported at the root so runtime
// runners can `import { ... } from 'nukebg-core'` (the package `exports` map
// only exposes '.', so subpath imports like 'nukebg-core/cv/lama-crop' fail).
export {
  computeLamaCropRect,
  bilinearResizeRGBA,
  nearestResizeMask,
  spliceLamaOutput,
} from './cv/lama-crop.js';
export type { LamaCropRect } from './cv/lama-crop.js';

// Shared RMBG mask resampler (pixel-center offset — single source of truth)
export { resampleMask } from './cv/resample-mask.js';

// Shared PURE LaMa tensor packing (no onnxruntime; caller wraps ort.Tensor)
export { packRgbaToChw, packMaskToChw, unpackChwToRgba } from './cv/lama-tensors.js';

// Inpaint module — patchMatchInpaint with PATCHMATCH_PARAMS defaults (Phase 7)
export { patchMatchInpaint } from './inpaint/patch-match.js';
export type { PatchMatchOptions } from './inpaint/patch-match.js';

// Constants (read-only)
export {
  CV_PARAMS,
  WATERMARK_PARAMS,
  SPARKLE_PARAMS,
  DALLE_WATERMARK_PARAMS,
  SHADOW_PARAMS,
  ALPHA_PARAMS,
  EDGE_REFINE_PARAMS,
  PATCHMATCH_PARAMS,
  INPAINT_PARAMS,
  LAMA_PARAMS,
  LAMA_ROUTER_PARAMS,
  REFINE_PARAMS,
  PRECISION_PROFILES,
  IMAGE_CLASSIFY_PARAMS,
  MOBILESAM_PARAMS,
  RMBG_PARAMS,
  type PrecisionMode,
  type PrecisionProfile,
} from './pipeline/constants.js';
