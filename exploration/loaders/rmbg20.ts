/**
 * RMBG-2.0 loader via ONNX Runtime Web + WebGPU.
 *
 * Model: briaai/RMBG-2.0 FP16 ONNX (~176 MB).
 * License: CC BY-NC 4.0 (non-commercial).
 * Source: https://huggingface.co/briaai/RMBG-2.0
 *
 * This loader is only reachable when the model-lab UI is visible, which is
 * gated to localhost and *.pages.dev staging in exploration/lab-visibility.ts.
 * It never reaches production. If we ever pick RMBG-2.0 as the winner, the
 * licensing question has to be resolved before shipping.
 *
 * Pre/post-processing is identical to BiRefNet (ImageNet normalized NCHW
 * 1024×1024 input, single-channel logits output) so the helpers are reused.
 */

import * as ort from 'onnxruntime-web/webgpu';
import type { ModelLoader, SegmentInput, SegmentOutput } from './types';
import { preprocessImageNet } from './preprocess';
import { sigmoidResizeQuantize } from './postprocess';
import { createOrtSession } from './ort-session';
import { getHfToken } from '../hf-token';

const MODEL_URL =
  'https://huggingface.co/briaai/RMBG-2.0/resolve/main/onnx/model_fp16.onnx';
const MODEL_SIZE = 1024;

export function createRmbg20Loader(): ModelLoader {
  let session: ort.InferenceSession | null = null;
  let backend: 'webgpu' | 'wasm' = 'wasm';

  async function ensureSession(): Promise<ort.InferenceSession> {
    if (session) return session;
    const token = getHfToken();
    if (!token) {
      throw new Error(
        'RMBG-2.0 is a gated HF repo. Paste a read-scoped token in DevTools: ' +
          `localStorage.setItem('nukebg:hf-token', 'hf_...') and reload.`,
      );
    }
    const result = await createOrtSession({
      url: MODEL_URL,
      preferWebGpu: true,
      bearerToken: token,
    });
    session = result.session;
    backend = result.backend;
    return session;
  }

  return {
    id: 'rmbg-2.0',
    label: 'RMBG-2.0 (CC BY-NC, staging only)',
    approxDownloadMb: 176,
    requiresWebGpu: true,

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
