/**
 * BiRefNet-general loader via ONNX Runtime Web + WebGPU.
 *
 * Model: full Swin-L BiRefNet-general FP16 ONNX (~490 MB).
 * License: MIT.
 * Source (weights): https://huggingface.co/onnx-community/BiRefNet-ONNX
 * Original repo:    https://huggingface.co/ZhengPeng7/BiRefNet
 *
 * Implementation notes:
 *   - Weights live at a HuggingFace CDN URL (see MODEL_URL). If the ONNX isn't
 *     published under that exact path, the loader reports a clear error and the
 *     lab falls back to the baseline. Export instructions in exploration/README.md.
 *   - Input: NCHW float32 1x3x1024x1024, ImageNet-normalized.
 *   - BiRefNet emits multiple outputs; the final refined mask is last.
 *   - Output: sigmoid → bilinear upscale to input dims → Uint8 alpha 0..255.
 *   - ORT provider: WASM only. WebGPU path is blocked because ORT Web's
 *     current shader codegen emits invalid pipelines for BiRefNet's Slice +
 *     Concat ops (Firefox: too many storage buffers, Chrome: off-by-one on
 *     binding index >1000). Transformers.js partitions the graph differently
 *     and works on WebGPU — keep that as a future migration.
 */

import * as ort from 'onnxruntime-web/webgpu';
import type { ModelLoader, SegmentInput, SegmentOutput } from './types';
import { preprocessImageNet } from './preprocess';
import { sigmoidResizeQuantize } from './postprocess';
import { createOrtSession } from './ort-session';

const MODEL_URL =
  'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx';
const MODEL_SIZE = 1024;

export function createBiRefNetLoader(): ModelLoader {
  let session: ort.InferenceSession | null = null;
  let backend: 'webgpu' | 'wasm' = 'wasm';

  async function ensureSession(): Promise<ort.InferenceSession> {
    if (session) return session;
    const result = await createOrtSession({ url: MODEL_URL, preferWebGpu: false });
    session = result.session;
    backend = result.backend;
    return session;
  }

  return {
    id: 'birefnet-general',
    label: 'BiRefNet-general (full, MIT)',
    approxDownloadMb: 490,
    requiresWebGpu: false,

    async warmup() {
      await ensureSession();
    },

    async segment(input: SegmentInput): Promise<SegmentOutput> {
      const started = performance.now();
      const sess = await ensureSession();

      const { tensor } = preprocessImageNet(input.pixels, input.width, input.height, MODEL_SIZE);
      const feeds: Record<string, ort.Tensor> = {
        [sess.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, MODEL_SIZE, MODEL_SIZE]),
      };

      const results = await sess.run(feeds);
      // Final refined mask is conventionally the last output in BiRefNet exports.
      const maskOutput = results[sess.outputNames[sess.outputNames.length - 1]];
      const logits = maskOutput.data as Float32Array;

      const alpha = sigmoidResizeQuantize(logits, MODEL_SIZE, input.width, input.height);

      return {
        alpha,
        width: input.width,
        height: input.height,
        latencyMs: performance.now() - started,
        backend,
      };
    },

    async dispose() {
      if (session) {
        await session.release();
        session = null;
      }
    },
  };
}
