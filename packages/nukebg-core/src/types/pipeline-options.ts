import type { StageEvent } from './pipeline-result.js';

export type PipelineMode = 'photo' | 'signature' | 'icon' | 'auto';
export type PipelinePrecision = 'low' | 'normal' | 'high' | 'ultra';

export interface PipelineOptions {
  /** Default 'auto' (let the classifier decide) */
  readonly mode?: PipelineMode;
  /** Default 'normal' */
  readonly precision?: PipelinePrecision;
  /** Skip watermark detection + inpainting. Default false. */
  readonly skipWatermark?: boolean;
  /** Cancellation. */
  readonly signal?: AbortSignal;
  /** Stage event sink. Optional. */
  readonly onStage?: (event: StageEvent) => void;
}
