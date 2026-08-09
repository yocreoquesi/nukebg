import type { ImageDataLike } from './image-data-like.js';

/** Image content type for auto-algorithm selection */
export type ImageContentType = 'PHOTO' | 'SIGNATURE' | 'ICON';

/** Stage identifiers for progress reporting */
export type PipelineStage = 'detect-background' | 'ml-segmentation' | 'watermark-scan' | 'inpaint';

export type StageStatus = 'running' | 'done' | 'skipped' | 'error';

export interface StageEvent {
  stage: PipelineStage;
  status: StageStatus;
  message?: string;
}

/**
 * Pipeline output from `runPipeline`. Uses `ImageDataLike` so it is compatible
 * with both the browser's native `ImageData` and plain objects produced by
 * `createImageDataLike` in Node environments.
 */
export interface PipelineResult {
  /** Processed image with alpha channel */
  readonly output: ImageDataLike;
  /** The resolved content type — always one of photo / signature / icon */
  readonly resolvedMode: 'photo' | 'signature' | 'icon';
  /** Total wall-clock time from function entry to resolution in ms */
  readonly durationMs: number;
  /**
   * Per-stage timing in ms. MUST contain at least the keys:
   * "watermark", "rmbg", "inpaint", "finalize"
   */
  readonly stageTimings: Record<string, number>;
  /** Whether watermark was found and removed */
  readonly watermarkRemoved: boolean;
  /** Watermark mask at working resolution (0 or 1), if inpainting happened */
  readonly watermarkMask: Uint8Array | null;
  /** Working pixel buffer (possibly inpainted) */
  readonly workingPixels: Uint8ClampedArray;
  /** Alpha mask (0..255) */
  readonly workingAlpha: Uint8Array;
  /** Width of the working resolution buffer (matches output.width) */
  readonly workingWidth: number;
  /** Height of the working resolution buffer (matches output.height) */
  readonly workingHeight: number;
  /** Percentage of pixels made transparent */
  readonly nukedPct: number;
  /** Detected content type */
  readonly contentType: ImageContentType;
}
