/**
 * RMBG-2.0 loader — to be implemented in Phase 3.
 *
 * Plan:
 *   - Fetch weights from https://huggingface.co/briaai/RMBG-2.0 (FP16 ONNX)
 *   - Create ort.InferenceSession with executionProviders: ['webgpu', 'wasm']
 *   - Preprocess: resize to 1024x1024, normalize with ImageNet mean/std
 *   - Run inference → single-channel logits
 *   - Postprocess: sigmoid, resize back to input size, quantize to Uint8
 *
 * Note: CC BY-NC 4.0 license — this loader is only mounted when the UI
 * is running on a *.pages.dev or localhost host. Never in production.
 */

import type { ModelLoader, SegmentInput, SegmentOutput } from './types';

export function createRmbg20Loader(): ModelLoader {
  return {
    id: 'rmbg-2.0',
    label: 'RMBG-2.0 (CC BY-NC, staging only)',
    approxDownloadMb: 176,
    requiresWebGpu: true,
    async warmup() {
      throw new Error('rmbg20 loader: implement in Phase 3');
    },
    async segment(_input: SegmentInput): Promise<SegmentOutput> {
      throw new Error('rmbg20 loader: implement in Phase 3');
    },
    async dispose() {
      // released in Phase 3
    },
  };
}
