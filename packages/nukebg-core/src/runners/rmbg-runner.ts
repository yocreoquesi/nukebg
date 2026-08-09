import type { ImageDataLike } from '../types/image-data-like.js';

export interface RmbgRefineOptions {
  readonly spatialPasses: number;
  readonly spatialRadius: number;
  readonly morphOpenRadius: number;
  readonly clusterRatio: number;
  readonly minClusterSize: number;
}

/**
 * Background-removal model runner. Returns an alpha mask (0..255) at the
 * same dimensions as `input`. Implementations: BrowserRmbgRunner
 * (transformers.js + onnxruntime-web in a Worker), OnnxNodeRmbgRunner
 * (transformers.js + onnxruntime-node in-process).
 */
export interface RmbgRunner {
  /** Optional model preload. Throws on integrity failure. */
  load?(opts?: { signal?: AbortSignal }): Promise<void>;

  /**
   * Run segmentation. Resolves with a Uint8Array of length width*height.
   * Threshold and refine options match the existing RMBG worker contract.
   */
  segment(
    input: ImageDataLike,
    opts: {
      threshold: number;
      refine: RmbgRefineOptions;
      signal?: AbortSignal;
      onProgress?: (pct: number) => void;
    },
  ): Promise<Uint8Array>;

  dispose(): Promise<void>;
}
