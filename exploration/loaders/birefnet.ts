/**
 * BiRefNet-general loader — to be implemented in Phase 2.
 *
 * Plan:
 *   - Fetch weights from https://huggingface.co/ZhengPeng7/BiRefNet (FP16 ONNX, full SWIN-L)
 *   - Create ort.InferenceSession with executionProviders: ['webgpu', 'wasm']
 *   - Preprocess: resize to 1024x1024, normalize with ImageNet mean/std
 *   - BiRefNet has multi-stage outputs; we take the final refined mask
 *   - Postprocess: sigmoid, resize back, quantize
 *
 * If full weight (~220 MB) proves too slow or too heavy on mid-tier laptops,
 * we fall back to BiRefNet-lite (~80 MB) as a secondary option before killing
 * the candidate entirely.
 */

import type { ModelLoader, SegmentInput, SegmentOutput } from './types';

export function createBiRefNetLoader(): ModelLoader {
  return {
    id: 'birefnet-general',
    label: 'BiRefNet-general (full, MIT)',
    approxDownloadMb: 220,
    requiresWebGpu: true,
    async warmup() {
      throw new Error('birefnet loader: implement in Phase 2');
    },
    async segment(_input: SegmentInput): Promise<SegmentOutput> {
      throw new Error('birefnet loader: implement in Phase 2');
    },
    async dispose() {
      // released in Phase 2
    },
  };
}
