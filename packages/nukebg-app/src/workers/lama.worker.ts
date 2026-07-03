/**
 * LaMa Worker — Content-aware watermark reconstruction via ONNX.
 *
 * Wraps the opencv/inpainting_lama FP32 ONNX model (Apache 2.0, re-export
 * of Carve/LaMa-ONNX) behind a minimal message API. The model is loaded
 * lazily from the HuggingFace CDN on first `lama-inpaint` request and
 * stays cached in the session thereafter. Heavy inference runs off the
 * main thread; WASM backend is used because WebGPU is still unstable for
 * Fourier-convolution models in onnxruntime-web.
 *
 * Tensor contract (Carve/LaMa-ONNX export):
 *   image:  float32 [1, 3, 512, 512] RGB, values in [0, 1]
 *   mask:   float32 [1, 1, 512, 512] binary {0, 1}, 1 = inpaint
 *   output: float32 [1, 3, 512, 512] RGB, values in [0, 255]
 */
import * as ort from 'onnxruntime-web';
import type { LamaWorkerRequest, LamaWorkerResponse } from '../types/worker-messages';
import { LAMA_PARAMS, packRgbaToChw, packMaskToChw, unpackChwToRgba } from 'nukebg-core';
import {
  bilinearResizeRGBA,
  computeLamaCropRect,
  nearestResizeMask,
  spliceLamaOutput,
} from 'nukebg-core/cv/lama-crop';

// Point ORT at the JSDelivr CDN for its WASM runtime (ort-wasm-*.wasm +
// ort-wasm-*.mjs). Vite's dev server refuses to serve .mjs files out of
// `public/` via dynamic import ("This file is in /public ..."), and
// bundling ORT's runtime through Vite would blow up the build graph.
// The CDN serves the exact pinned dev build with correct `application/wasm`
// MIME; our _headers CSP already whitelists cdn.jsdelivr.net for
// script-src and connect-src (transformers.js reaches the same CDN).
// Bump this version string in lockstep with package.json's onnxruntime-web
// dependency so the runtime matches the JS API we link against.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

// The LaMa graph has ~80 unused Conv shape initializers that ORT logs as
// warnings at session-create time. They're harmless (graph optimiser
// cleans them up) but noisy — clamp ORT's logger to error-level only.
ort.env.logLevel = 'error';

let session: ort.InferenceSession | null = null;
let sessionLoadPromise: Promise<ort.InferenceSession> | null = null;

async function loadModel(id: string): Promise<ort.InferenceSession> {
  if (session) return session;
  if (sessionLoadPromise) return sessionLoadPromise;

  sessionLoadPromise = (async () => {
    const response = await fetch(LAMA_PARAMS.MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch LaMa model: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('LaMa model response has no readable stream');
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastReportedPct = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastReportedPct) {
          lastReportedPct = pct;
          self.postMessage({
            id,
            type: 'lama-model-progress',
            progress: pct,
          } satisfies LamaWorkerResponse);
        }
      }
    }

    // Validate stream completeness. A truncated body (connection drop,
    // proxy cap) would otherwise flow through and blow up inside ORT
    // with an opaque "failed to load model" — we want a specific,
    // retryable error instead.
    if (total > 0 && received !== total) {
      throw new Error(`Truncated LaMa model download: got ${received} / ${total} bytes`);
    }
    if (received !== LAMA_PARAMS.EXPECTED_SIZE) {
      throw new Error(
        `LaMa model size mismatch: got ${received} bytes, expected ` +
          `${LAMA_PARAMS.EXPECTED_SIZE}. Upstream may have been replaced.`,
      );
    }

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.byteLength;
    }

    // Integrity check: fail closed if the downloaded bytes don't match
    // the audited SHA-256. Protects against an upstream swap, a MITM,
    // or a poisoned Service Worker cache serving unverified content.
    const digestBuf = await crypto.subtle.digest('SHA-256', buffer);
    const digestHex = Array.from(new Uint8Array(digestBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (digestHex !== LAMA_PARAMS.EXPECTED_SHA256) {
      throw new Error(
        `LaMa model hash mismatch: got ${digestHex}, ` +
          `expected ${LAMA_PARAMS.EXPECTED_SHA256}. Refusing to load.`,
      );
    }

    const created = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      // 3 = error, 4 = fatal. Silences the per-initializer warnings the
      // LaMa graph emits during CleanUnusedInitializersAndNodeArgs.
      logSeverityLevel: 3,
    });
    session = created;
    self.postMessage({ id, type: 'lama-model-ready' } satisfies LamaWorkerResponse);
    return created;
  })();

  try {
    return await sessionLoadPromise;
  } finally {
    sessionLoadPromise = null;
  }
}

// Tensor pack/unpack is the shared PURE NCHW math from nukebg-core
// (`packRgbaToChw`/`packMaskToChw`/`unpackChwToRgba`); only the
// `onnxruntime-web` `ort.Tensor` wrap is runtime-specific and stays here.

async function runInpaint(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): Promise<void> {
  self.postMessage({
    id,
    type: 'lama-inpaint-progress',
    stage: 'loading-model',
  } satisfies LamaWorkerResponse);
  const sess = await loadModel(id);

  self.postMessage({
    id,
    type: 'lama-inpaint-progress',
    stage: 'preparing-tensors',
  } satisfies LamaWorkerResponse);

  const rect = computeLamaCropRect(mask, width, height);
  if (!rect) {
    // Empty mask — nothing to reconstruct. Return the input unchanged.
    self.postMessage({
      id,
      type: 'lama-inpaint-result',
      result: new Uint8ClampedArray(pixels),
    } satisfies LamaWorkerResponse);
    return;
  }

  const inputSize = LAMA_PARAMS.INPUT_SIZE;
  const cropRgba = bilinearResizeRGBA(pixels, width, rect, inputSize);
  const cropMask = nearestResizeMask(mask, width, rect, inputSize);

  const imageTensor = new ort.Tensor(
    'float32',
    packRgbaToChw(cropRgba, inputSize, inputSize),
    [1, 3, inputSize, inputSize],
  );
  const maskTensor = new ort.Tensor(
    'float32',
    packMaskToChw(cropMask, inputSize, inputSize),
    [1, 1, inputSize, inputSize],
  );

  self.postMessage({
    id,
    type: 'lama-inpaint-progress',
    stage: 'running-inference',
  } satisfies LamaWorkerResponse);

  const feeds: Record<string, ort.Tensor> = {
    [LAMA_PARAMS.IMAGE_INPUT_NAME]: imageTensor,
    [LAMA_PARAMS.MASK_INPUT_NAME]: maskTensor,
  };
  const results = await sess.run(feeds);
  const outputKey = sess.outputNames[0];
  const outputTensor = results[outputKey];

  self.postMessage({
    id,
    type: 'lama-inpaint-progress',
    stage: 'compositing',
  } satisfies LamaWorkerResponse);

  const inpaintedCropRgba = unpackChwToRgba(outputTensor.data as Float32Array, inputSize, inputSize);
  const full = spliceLamaOutput(pixels, width, height, inpaintedCropRgba, inputSize, rect);

  self.postMessage({ id, type: 'lama-inpaint-result', result: full } satisfies LamaWorkerResponse, [
    full.buffer,
  ]);
}

self.onmessage = async (e: MessageEvent<LamaWorkerRequest>) => {
  // Reject cross-origin postMessage (CodeQL js/missing-origin-check, #187).
  // Empty-origin events are allowed: dedicated Workers receive '' in some
  // browsers; same-origin spawning is enforced by the page's CSP.
  if (e.origin && e.origin !== self.location.origin) return;
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'lama-load-model': {
        await loadModel(msg.id);
        break;
      }
      case 'lama-inpaint': {
        const { payload } = msg;
        await runInpaint(msg.id, payload.pixels, payload.width, payload.height, payload.mask);
        break;
      }
      case 'lama-dispose': {
        if (session) {
          try {
            await session.release();
          } catch {
            // Some ORT builds throw on release — ignore, we drop the ref below.
          }
          session = null;
        }
        self.postMessage({ id: msg.id, type: 'lama-disposed' } satisfies LamaWorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      id: msg.id,
      type: 'error',
      error: String(err),
    } satisfies LamaWorkerResponse);
  }
};
