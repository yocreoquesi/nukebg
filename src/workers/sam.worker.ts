/**
 * MobileSAM Worker — interactive click-to-segment via ONNX.
 *
 * Two-phase architecture:
 *   1. Encoder (runs ONCE per image, ~3-8s WASM): resizes to 1024×1024,
 *      normalizes with ImageNet stats, produces image_embeddings that are
 *      cached for the session.
 *   2. Decoder (runs per click, <300ms): takes cached embeddings + point
 *      prompts, returns a 256×256 mask upscaled to the original image size.
 *
 * Models: Acly/MobileSAM on HuggingFace (MIT license).
 * Tensor contract matches the standard SAM ONNX export.
 */
import * as ort from 'onnxruntime-web';
import type { SamWorkerRequest, SamWorkerResponse } from '../types/worker-messages';
const SAM_PARAMS = {
  ENCODER_URL: 'https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx',
  DECODER_URL: 'https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_single.onnx',
  INPUT_SIZE: 1024,
  MASK_SIZE: 256,
  MASK_THRESHOLD: 0.0,
} as const;

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
ort.env.logLevel = 'error';

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let loadPromise: Promise<void> | null = null;

// Cached between encode→decode calls. Cleared on new encode or dispose.
let cachedEmbeddings: ort.Tensor | null = null;
let cachedScale = 1;

// ────────────────────────────── Model loading ──────────────────────────────

async function fetchModel(
  url: string,
  id: string,
  stage: 'encoder' | 'decoder',
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SAM ${stage} fetch failed: HTTP ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`SAM ${stage}: no readable stream`);

  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        self.postMessage({
          id,
          type: 'sam-load-progress',
          progress: pct,
          stage,
        } satisfies SamWorkerResponse);
      }
    }
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buffer.set(c, offset);
    offset += c.byteLength;
  }
  return buffer;
}

async function loadModels(id: string): Promise<void> {
  if (encoderSession && decoderSession) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const opts: ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    };
    const [encBuf, decBuf] = await Promise.all([
      fetchModel(SAM_PARAMS.ENCODER_URL, id, 'encoder'),
      fetchModel(SAM_PARAMS.DECODER_URL, id, 'decoder'),
    ]);
    encoderSession = await ort.InferenceSession.create(encBuf, opts);
    decoderSession = await ort.InferenceSession.create(decBuf, opts);
    self.postMessage({ id, type: 'sam-ready' } satisfies SamWorkerResponse);
  })();

  try {
    await loadPromise;
  } catch {
    loadPromise = null;
    throw new Error('Failed to load SAM models');
  }
}

// ────────────────────────────── Encode ──────────────────────────────────────

function preprocessForEncoder(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): { tensor: ort.Tensor; scale: number } {
  const S = SAM_PARAMS.INPUT_SIZE; // 1024
  const scale = S / Math.max(w, h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  // Bilinear resize RGBA → extract RGB into HWC float32, zero-pad to
  // 1024×1024. The Acly encoder normalizes internally — we pass 0-255.
  const resized = bilinearResize(pixels, w, h, nw, nh);
  const data = new Float32Array(S * S * 3);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const srcIdx = (y * nw + x) * 4;
      const dstIdx = (y * S + x) * 3;
      data[dstIdx] = resized[srcIdx];
      data[dstIdx + 1] = resized[srcIdx + 1];
      data[dstIdx + 2] = resized[srcIdx + 2];
    }
  }
  return { tensor: new ort.Tensor('float32', data, [S, S, 3]), scale };
}

function bilinearResize(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = y * yr;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = x * xr;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const fx = sx - x0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const idx = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[idx + c] = Math.round(
          src[i00 + c] * (1 - fx) * (1 - fy) +
            src[i10 + c] * fx * (1 - fy) +
            src[i01 + c] * (1 - fx) * fy +
            src[i11 + c] * fx * fy,
        );
      }
    }
  }
  return out;
}

async function encode(id: string, pixels: Uint8ClampedArray, w: number, h: number): Promise<void> {
  await loadModels(id);
  if (!encoderSession) throw new Error('Encoder not loaded');

  const { tensor, scale } = preprocessForEncoder(pixels, w, h);
  cachedScale = scale;

  // Detect the encoder's input name dynamically — different ONNX exports
  // use different names ("input_image", "pixel_values", "images", ...).
  const inputName = encoderSession.inputNames[0];
  const result = await encoderSession.run({ [inputName]: tensor });

  // The encoder's first (and typically only) output is image_embeddings.
  const outputName = encoderSession.outputNames[0];
  cachedEmbeddings = result[outputName];

  self.postMessage({ id, type: 'sam-encoded' } satisfies SamWorkerResponse);
}

// ────────────────────────────── Decode ──────────────────────────────────────

async function decode(
  id: string,
  points: Array<{ x: number; y: number }>,
  labels: number[],
  w: number,
  h: number,
): Promise<void> {
  if (!decoderSession || !cachedEmbeddings) {
    throw new Error('Must encode an image before decoding');
  }

  const n = points.length;
  // SAM decoder expects an extra padding point at the end.
  const coordsData = new Float32Array((n + 1) * 2);
  const labelsData = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    // Scale point coordinates to the encoder's 1024-padded space.
    coordsData[i * 2] = points[i].x * cachedScale;
    coordsData[i * 2 + 1] = points[i].y * cachedScale;
    labelsData[i] = labels[i];
  }
  // Padding point
  coordsData[n * 2] = 0;
  coordsData[n * 2 + 1] = 0;
  labelsData[n] = -1;

  const M = SAM_PARAMS.MASK_SIZE; // 256
  const feeds: Record<string, ort.Tensor> = {
    image_embeddings: cachedEmbeddings,
    point_coords: new ort.Tensor('float32', coordsData, [1, n + 1, 2]),
    point_labels: new ort.Tensor('float32', labelsData, [1, n + 1]),
    mask_input: new ort.Tensor('float32', new Float32Array(M * M), [1, 1, M, M]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor('float32', new Float32Array([h, w]), [2]),
  };

  const result = await decoderSession.run(feeds);

  // The decoder output "masks" is [1, 1, H, W] with logit values.
  // Threshold at 0 (sigmoid(0)=0.5) and return a binary mask at the
  // original image resolution.
  const masksKey = decoderSession.outputNames.includes('masks')
    ? 'masks'
    : decoderSession.outputNames[0];
  const maskTensor = result[masksKey];
  const maskData = maskTensor.data as Float32Array;
  const maskH = maskTensor.dims[2];
  const maskW = maskTensor.dims[3];

  // The decoder may output at orig_im_size or at a fixed 256×256.
  // If it's already at original size, threshold directly.
  // If low-res, upscale to original size then threshold.
  const binary = new Uint8Array(w * h);
  if (maskW === w && maskH === h) {
    for (let i = 0; i < maskData.length; i++) {
      binary[i] = maskData[i] > SAM_PARAMS.MASK_THRESHOLD ? 1 : 0;
    }
  } else {
    // Nearest-neighbor upscale from maskW×maskH → w×h.
    const xr = maskW / w;
    const yr = maskH / h;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(Math.floor(y * yr), maskH - 1);
      for (let x = 0; x < w; x++) {
        const sx = Math.min(Math.floor(x * xr), maskW - 1);
        binary[y * w + x] = maskData[sy * maskW + sx] > SAM_PARAMS.MASK_THRESHOLD ? 1 : 0;
      }
    }
  }

  self.postMessage({
    id,
    type: 'sam-mask',
    mask: binary,
    width: w,
    height: h,
  } satisfies SamWorkerResponse);
}

// ────────────────────────────── Dispose ─────────────────────────────────────

function dispose(): void {
  encoderSession?.release();
  decoderSession?.release();
  encoderSession = null;
  decoderSession = null;
  loadPromise = null;
  cachedEmbeddings = null;
  cachedScale = 1;
}

// ────────────────────────────── Message router ─────────────────────────────

self.addEventListener('message', async (e: MessageEvent<SamWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'sam-load':
        await loadModels(msg.id);
        break;
      case 'sam-encode':
        await encode(msg.id, msg.payload.pixels, msg.payload.width, msg.payload.height);
        break;
      case 'sam-decode':
        await decode(
          msg.id,
          msg.payload.points,
          msg.payload.labels,
          msg.payload.width,
          msg.payload.height,
        );
        break;
      case 'sam-dispose':
        dispose();
        self.postMessage({ id: msg.id, type: 'sam-disposed' } satisfies SamWorkerResponse);
        break;
    }
  } catch (err) {
    self.postMessage({
      id: msg.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    } satisfies SamWorkerResponse);
  }
});
