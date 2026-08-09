import type { ImageDataLike } from '../types/image-data-like.js';
import type { PipelineOptions } from '../types/pipeline-options.js';
import type { PipelineResult } from '../types/pipeline-result.js';

/**
 * Runs the full pipeline on an image. Implementations differ by HOW the
 * stages execute (Worker-backed in browser, inline in Node) but the
 * contract is identical.
 */
export interface PipelineRunner {
  /**
   * Process a single image end-to-end. Resolves with a frozen
   * PipelineResult. Rejects with PipelineAbortError if `options.signal`
   * fires, or with a regular Error on stage failure.
   */
  run(input: ImageDataLike, options?: PipelineOptions): Promise<PipelineResult>;

  /** Pre-load any models eagerly. Optional; runners may no-op. */
  preload?(): Promise<void>;

  /** Release resources (workers, ONNX sessions, file handles). */
  dispose(): Promise<void>;
}
