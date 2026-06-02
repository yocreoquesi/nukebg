import type { ImageDataLike } from '../types/image-data-like.js';

/**
 * LaMa ONNX inpainting runner. Takes RGBA pixels + a binary mask
 * (0=keep, 1=inpaint) and returns RGBA pixels with the masked region
 * reconstructed. Same dimensions on input and output.
 */
export interface LamaRunner {
  load?(opts?: { signal?: AbortSignal }): Promise<void>;

  inpaint(
    input: ImageDataLike,
    mask: Uint8Array,
    opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void },
  ): Promise<Uint8ClampedArray>;

  dispose(): Promise<void>;
}
