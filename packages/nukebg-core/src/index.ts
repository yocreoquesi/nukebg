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

// Pure CV functions — public for advanced consumers, also used by the app's WorkerPipelineRunner
export * as cv from './cv/index.js';

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
