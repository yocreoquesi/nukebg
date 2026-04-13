import type { PipelineResult } from './pipeline';

/** Per-item state in a batch-processing run. */
export type BatchItemState =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'discarded';

/**
 * A single image slot in the batch grid.
 * Lives in ar-app state; rendered by ar-batch-grid + ar-batch-item.
 */
export interface BatchItem {
  id: string;
  originalName: string;
  file: File;
  imageData: ImageData;
  state: BatchItemState;
  result: PipelineResult | null;
  thumbnailUrl: string | null;
  errorMessage?: string;
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
