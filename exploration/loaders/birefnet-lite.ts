/**
 * BiRefNet-lite loader — Swin-T variant of BiRefNet.
 *
 * Model: BiRefNet_lite FP16 ONNX (~115 MB).
 * License: MIT.
 * Source: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX
 *
 * Smaller, faster, and fits comfortably in the WASM heap (the full
 * BiRefNet-general at 490MB triggers OOM on WASM; use lite until we
 * migrate to Transformers.js so WebGPU can host the big graph).
 *
 * Pre/post-processing matches the general variant: NCHW 1x3x1024x1024,
 * ImageNet-normalized, sigmoid mask output.
 */

import * as ort from 'onnxruntime-web/webgpu';
import type { ModelLoader, SegmentInput, SegmentOutput } from './types';
import { preprocessImageNet } from './preprocess';
import { sigmoidResizeQuantize } from './postprocess';
import { createOrtSession } from './ort-session';

const MODEL_URL =
  'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx';
const MODEL_SIZE = 1024;

export function createBiRefNetLiteLoader(): ModelLoader {
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
    id: 'birefnet-lite',
    label: 'BiRefNet-lite (Swin-T, MIT)',
    approxDownloadMb: 115,
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
