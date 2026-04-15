/**
 * Shared contract every model loader in the lab must satisfy.
 * Keeps the UI selector and bbox-refine mode model-agnostic.
 */

export type ModelId = 'rmbg-1.4' | 'rmbg-2.0' | 'birefnet-general' | 'birefnet-lite';
export type InferenceMode = 'single-pass' | 'bbox-refine';

export interface SegmentInput {
  /** Packed RGBA pixels at arbitrary resolution. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SegmentOutput {
  /** Alpha mask 0..255 at the input resolution (loader handles resampling). */
  alpha: Uint8Array;
  width: number;
  height: number;
  /** Inference latency including pre/post-processing. */
  latencyMs: number;
  /** Which execution provider actually ran (webgpu | wasm). */
  backend: 'webgpu' | 'wasm';
}

export interface ModelLoader {
  id: ModelId;
  /** Human-readable label for the selector dropdown. */
  label: string;
  /** Approximate download size to warn the user before first load. */
  approxDownloadMb: number;
  /** True when the model requires WebGPU (no viable WASM fallback). */
  requiresWebGpu: boolean;
  /** Warm the model weights. Idempotent — safe to call multiple times. */
  warmup(): Promise<void>;
  /** Run one inference. */
  segment(input: SegmentInput): Promise<SegmentOutput>;
  /** Release WebGPU resources and free the ONNX session. */
  dispose(): Promise<void>;
}
