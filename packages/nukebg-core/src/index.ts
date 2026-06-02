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
