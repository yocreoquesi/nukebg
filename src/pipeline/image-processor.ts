import type { PipelineResult, PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import type { PrecisionMode } from './constants';

/**
 * Stage callback the processor invokes to surface progress to the UI.
 * Mirrors the type used by the concrete orchestrator — co-located here
 * so callers depending on `ImageProcessor` don't transitively pick up
 * the orchestrator.
 */
export type StageCallback = (
  stage: PipelineStage,
  status: StageStatus,
  message?: string,
) => void;

/**
 * Public surface every image-processing engine in the app honours.
 *
 * Components (`ar-app`) and controllers (`batch-orchestrator`) used to
 * hold a hard reference to the concrete `PipelineOrchestrator` class.
 * That coupled UI orchestration (queue, editor state, abort) to
 * algorithm orchestration (workers, timeouts, watermark routing) so
 * tightly that batch retry logic could not be unit-tested without
 * spinning up real Web Workers. Tests had to mock the orchestrator
 * module, not just the contract.
 *
 * `ImageProcessor` is the contract. PipelineOrchestrator realises it.
 * Components depend on this type; the only place that names the
 * concrete class is the factory that builds it (currently `ar-app`'s
 * lifecycle hooks). Editor reprocess flows reuse the same instance via
 * its `estimateForeground` capability — keep that public so the
 * advanced editor's halo-decontaminate pass can run on the same
 * foreground solver the pipeline ships.
 */
export interface ImageProcessor {
  /** Run the full pipeline on an image and return the working-resolution result. */
  process(
    imageData: ImageData,
    modelId?: ModelId,
    precision?: PrecisionMode,
    signal?: AbortSignal,
  ): Promise<PipelineResult>;

  /** Pre-load the segmentation model so the first image doesn't pay the cold start. */
  preloadModel(modelId?: ModelId): Promise<void>;

  /**
   * Decontaminate foreground RGB at original resolution. Used by editor
   * reprocess flows after they've composed RGBA at full size.
   */
  estimateForeground(
    pixels: Uint8ClampedArray,
    alpha: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8ClampedArray>;

  /** Hard-abort the in-flight run. Pending promises reject with `PipelineAbortError`. */
  abort(reason?: string): void;

  /** Update the stage callback (used when reusing a processor across images). */
  setStageCallback(cb: StageCallback): void;

  /** Tear down workers and pending state. The instance is unusable afterwards. */
  destroy(): void;
}
