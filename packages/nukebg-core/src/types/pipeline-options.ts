import type { StageEvent } from './pipeline-result.js';
import type { PipelineTimeouts } from '../pipeline/constants.js';

export type PipelineMode = 'photo' | 'signature' | 'icon' | 'auto';
export type PipelinePrecision = 'low' | 'normal' | 'high' | 'ultra';

export interface PipelineOptions {
  /** Default 'auto' (let the classifier decide) */
  readonly mode?: PipelineMode;
  /** Default 'normal' */
  readonly precision?: PipelinePrecision;
  /** Skip watermark detection + inpainting. Default false. */
  readonly skipWatermark?: boolean;
  /**
   * Skip auto-cropping the result to the subject's bounding box. Default false.
   *
   * Reserved/no-op flag for v1: `runPipeline` does NOT perform auto-crop —
   * auto-crop is an export-time step owned by the app (see
   * `nukebg-core/pipeline/auto-crop`, invoked by the browser at export). The
   * field exists so callers (the CLI's `--no-auto-crop`) can carry the intent
   * through `PipelineOptions` and so an export-time cropper can honor it,
   * matching the browser where auto-crop runs at export rather than in the
   * core orchestrator.
   */
  readonly skipAutoCrop?: boolean;
  /** Cancellation. */
  readonly signal?: AbortSignal;
  /**
   * Per-stage and whole-run time budgets in milliseconds. Any omitted key
   * falls back to `PIPELINE_TIMEOUTS`.
   *
   * Only the asynchronous stages can actually be bounded — a `Promise.race`
   * cannot interrupt synchronous CV on the same thread — but those are where
   * the real hangs live (a stalled model fetch). Pass `Infinity` for a key to
   * opt out of that budget.
   */
  readonly timeouts?: Partial<PipelineTimeouts>;
  /** Stage event sink. Optional. */
  readonly onStage?: (event: StageEvent) => void;
}
