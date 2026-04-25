/** Image content type for auto-algorithm selection */
export type ImageContentType = 'PHOTO' | 'ILLUSTRATION' | 'SIGNATURE' | 'ICON';

/** Stage identifiers for progress reporting */
export type PipelineStage =
  | 'detect-background'
  | 'ml-segmentation'
  | 'watermark-scan'
  | 'inpaint';

export type StageStatus = 'running' | 'done' | 'skipped' | 'error';

export interface StageEvent {
  stage: PipelineStage;
  status: StageStatus;
  message?: string;
}

/**
 * Pipeline output. Buffers (`workingPixels`, `workingAlpha`, `watermarkMask`)
 * are caller-owned but **treated as read-only snapshots** — mutating them
 * would corrupt subsequent exports and editor operations that reference the
 * same result. The object itself is `Object.freeze`'d before return; types
 * are marked `readonly` so the compiler catches accidental reassignment.
 * If you need to mutate, clone first (e.g. `new Uint8ClampedArray(buffer)`).
 */
export interface PipelineResult {
  /** Processed image with alpha channel (at the working resolution fed to the pipeline) */
  readonly imageData: ImageData;
  /**
   * RGB pixels at working resolution, possibly modified by inpainting.
   * Exposed so callers can upscale and composite into a full-resolution
   * output when the pipeline ran on a downscaled working copy.
   */
  readonly workingPixels: Uint8ClampedArray;
  /** Alpha mask at working resolution (0..255) */
  readonly workingAlpha: Uint8Array;
  /** Working width — matches imageData.width */
  readonly workingWidth: number;
  /** Working height — matches imageData.height */
  readonly workingHeight: number;
  /**
   * Watermark mask at working resolution (0 or 1), if inpainting happened.
   * Used by the final composite to blend upscaled inpainted RGB only in
   * the watermark region, preserving pristine original RGB elsewhere.
   */
  readonly watermarkMask: Uint8Array | null;
  /** Total processing time in ms */
  readonly totalTimeMs: number;
  /** Whether watermark was found and removed */
  readonly watermarkRemoved: boolean;
  /** Percentage of pixels made transparent */
  readonly nukedPct: number;
  /** Per-stage timing breakdown */
  readonly stageTiming: Partial<Record<PipelineStage, number>>;
  /** Detected content type for auto-algorithm selection */
  readonly contentType: ImageContentType;
}

/** Result from background color detection */
export interface BgColorResult {
  colorA: number[];  // RGB, 3 values
  colorB: number[];  // RGB, 3 values
  isCheckerboard: boolean;
  cornerVariance: number;
}

/** Result from checker grid detection */
export interface GridResult {
  gridSize: number;
  phase: number;
}

/** Result from watermark detection */
export interface WatermarkResult {
  detected: boolean;
  mask: Uint8Array | null;
  centerX?: number;
  centerY?: number;
  radius?: number;
}
