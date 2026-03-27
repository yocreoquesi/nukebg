/** Background type classification */
export type BackgroundType = 'checkerboard' | 'solid' | 'complex';

/** Stage identifiers for progress reporting */
export type PipelineStage =
  | 'detect-background'
  | 'checkerboard-removal'
  | 'background-removal'
  | 'ml-segmentation'
  | 'watermark-scan'
  | 'inpaint'
  | 'shadow-cleanup'
  | 'alpha-refine'
  | 'edge-refine';

export type StageStatus = 'running' | 'done' | 'skipped' | 'error';

export interface StageEvent {
  stage: PipelineStage;
  status: StageStatus;
  message?: string;
}

export interface PipelineResult {
  /** Processed image with alpha channel */
  imageData: ImageData;
  /** Total processing time in ms */
  totalTimeMs: number;
  /** Background type that was detected */
  backgroundType: BackgroundType;
  /** Whether watermark was found and removed */
  watermarkRemoved: boolean;
  /** Per-stage timing breakdown */
  stageTiming: Partial<Record<PipelineStage, number>>;
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
