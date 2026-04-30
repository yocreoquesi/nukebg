/**
 * RMBG-1.4 loader for the lab — Transformers.js on the main thread.
 *
 * Mirrors the config used by src/workers/ml.worker.ts (INT8 quant, pinned
 * revision SHA) so lab measurements track the real production baseline.
 * Kept as a separate main-thread instance rather than plumbing into the
 * worker so the lab can be invoked with simple sync calls from the
 * compare viewer / bbox-refine. Extra ~45MB in memory is acceptable for
 * staging-only exploration.
 */

const MODEL_ID = 'briaai/RMBG-1.4';
const MODEL_REVISION = '2ceba5a5efaec153162aedea169f76caf9b46cf8';

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

/**
 * Surface the lab UI + advanced editor depend on. The factory used to
 * dispatch over a `ModelId` union, but RMBG-1.4 has been the only entry
 * for the lifetime of this code path; the union earned no leverage.
 * Callers import `createRmbg14Loader()` directly now.
 */
export interface Rmbg14Loader {
  /** Human-readable label for the selector dropdown. */
  label: string;
  /** Approximate download size to warn the user before first load. */
  approxDownloadMb: number;
  /** Warm the model weights. Idempotent — safe to call multiple times. */
  warmup(): Promise<void>;
  /** Run one inference. */
  segment(input: SegmentInput): Promise<SegmentOutput>;
  /** Release WebGPU resources and free the ONNX session. */
  dispose(): Promise<void>;
}

interface MaskOut {
  mask?: { data: Uint8Array; width: number; height: number };
}
type SegPipeline = {
  dispose?: () => void;
  (image: unknown, opts: { threshold: number; return_mask: boolean }): Promise<MaskOut[]>;
};

type RawImageCtor = new (
  data: Uint8ClampedArray,
  w: number,
  h: number,
  channels: number,
) => unknown;

export function createRmbg14Loader(): Rmbg14Loader {
  let segPipeline: SegPipeline | null = null;
  let RawImage: RawImageCtor | null = null;

  async function ensurePipeline(): Promise<SegPipeline> {
    if (segPipeline) return segPipeline;
    const transformers = await import('@huggingface/transformers');
    transformers.env.allowLocalModels = false;
    transformers.env.allowRemoteModels = true;
    RawImage = transformers.RawImage as unknown as RawImageCtor;
    const pipe = await transformers.pipeline('image-segmentation', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      revision: MODEL_REVISION,
    });
    segPipeline = pipe as unknown as SegPipeline;
    return segPipeline;
  }

  return {
    label: 'RMBG-1.4 (baseline, INT8)',
    approxDownloadMb: 45,

    async warmup() {
      await ensurePipeline();
    },

    async segment(input: SegmentInput): Promise<SegmentOutput> {
      const started = performance.now();
      const pipe = await ensurePipeline();
      if (!RawImage) throw new Error('RawImage class not loaded');

      const image = new RawImage(input.pixels, input.width, input.height, 4);
      const results = await pipe(image, { threshold: 0.5, return_mask: true });
      const mask = results[0]?.mask;
      if (!mask) throw new Error('RMBG-1.4 returned no mask');

      const alpha = resizeBilinear(mask.data, mask.width, mask.height, input.width, input.height);

      return {
        alpha,
        width: input.width,
        height: input.height,
        latencyMs: performance.now() - started,
        backend: 'wasm',
      };
    },

    async dispose() {
      if (segPipeline?.dispose) {
        try {
          segPipeline.dispose();
        } catch {
          // ignore
        }
      }
      segPipeline = null;
    },
  };
}

function resizeBilinear(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(src);
  const out = new Uint8Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = y * sy;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = x * sx;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = fx - x0;
      const v00 = src[y0 * srcW + x0];
      const v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];
      const top = v00 + (v10 - v00) * dx;
      const bot = v01 + (v11 - v01) * dx;
      out[y * dstW + x] = Math.round(top + (bot - top) * dy);
    }
  }
  return out;
}
