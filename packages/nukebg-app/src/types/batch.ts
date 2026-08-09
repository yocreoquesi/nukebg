import type { PipelineResult, PipelineStage, StageStatus } from './pipeline';

/** Per-item state in a batch-processing run. */
export type BatchItemState = 'pending' | 'processing' | 'done' | 'failed' | 'discarded';

/**
 * Snapshot of a single stage transition emitted by the pipeline.
 * Captured per BatchItem so its progress console can be faithfully
 * replayed (icons + timings + skipped stages) when the user reopens
 * the detail view after the item has finished.
 */
export interface StageSnapshot {
  stage: PipelineStage;
  status: StageStatus;
  message?: string;
}

/**
 * A single image slot in the batch grid.
 * Lives in ar-app state; rendered by ar-batch-grid + ar-batch-item.
 */
export interface BatchItem {
  id: string;
  originalName: string;
  file: File;
  /** Working (possibly downsampled) ImageData fed to the pipeline. */
  imageData: ImageData;
  /** Full-resolution pixels used for the final composite. */
  originalImageData: ImageData;
  state: BatchItemState;
  /** Final ImageData at original resolution (after composite upscale).
   *  Used for the before/after slider in detail view — keeps original
   *  alignment with `originalImageData`. */
  finalImageData: ImageData | null;
  /** Cropped to the subject bbox (autocrop). Used for export (download
   *  button + ZIP). Null until the item finishes; when null, callers
   *  fall back to `finalImageData`. */
  exportImageData?: ImageData | null;
  result: PipelineResult | null;
  thumbnailUrl: string | null;
  errorMessage?: string;
  stageHistory: StageSnapshot[];
}

/** Batch size caps. Mobile uses a lower cap for memory/performance reasons. */
export const BATCH_LIMITS = {
  DESKTOP: 12,
  MOBILE: 6,
  /** Breakpoint below which we apply the mobile cap (px, matches other components). */
  MOBILE_BREAKPOINT: 768,
} as const;

/** Compute the current batch cap based on viewport width. */
export function getBatchLimit(): number {
  if (typeof window === 'undefined') return BATCH_LIMITS.DESKTOP;
  return window.innerWidth < BATCH_LIMITS.MOBILE_BREAKPOINT
    ? BATCH_LIMITS.MOBILE
    : BATCH_LIMITS.DESKTOP;
}
