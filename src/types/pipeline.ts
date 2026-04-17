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

export interface PipelineResult {
  /** Processed image with alpha channel (at the working resolution fed to the pipeline) */
  imageData: ImageData;
  /**
   * RGB pixels at working resolution, possibly modified by inpainting.
   * Exposed so callers can upscale and composite into a full-resolution
   * output when the pipeline ran on a downscaled working copy.
   */
  workingPixels: Uint8ClampedArray;
  /** Alpha mask at working resolution (0..255) */
  workingAlpha: Uint8Array;
  /** Working width — matches imageData.width */
  workingWidth: number;
  /** Working height — matches imageData.height */
  workingHeight: number;
  /**
   * Watermark mask at working resolution (0 or 1), if inpainting happened.
   * Used by the final composite to blend upscaled inpainted RGB only in
   * the watermark region, preserving pristine original RGB elsewhere.
   */
  watermarkMask: Uint8Array | null;
  /** Total processing time in ms */
  totalTimeMs: number;
  /** Whether watermark was found and removed */
  watermarkRemoved: boolean;
  /** Percentage of pixels made transparent */
  nukedPct: number;
  /** Per-stage timing breakdown */
  stageTiming: Partial<Record<PipelineStage, number>>;
  /** Detected content type for auto-algorithm selection */
  contentType: ImageContentType;
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
