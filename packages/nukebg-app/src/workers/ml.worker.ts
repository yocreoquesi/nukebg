/**
 * ML Worker - Background removal via Transformers.js
 * Uses briaai/RMBG-1.4 through the high-level pipeline API.
 * Transformers.js handles ONNX Runtime, WebGPU/WASM detection,
 * model download, caching - all internally.
 */
import type {
  MlWorkerRequest,
  MlRefineOptions,
  ModelId,
  WarmupDiagnostic,
} from '../types/worker-messages';
import { refineMask, RMBG_PARAMS } from 'nukebg-core';

const DEFAULT_MODEL: ModelId = 'briaai/RMBG-1.4';

// Pin model to a specific revision SHA for supply-chain safety.
// Transformers.js defaults to 'main' branch, which can change silently.
// Pinning guarantees the exact same model weights every load.
// Bump manually after auditing upstream changes on huggingface.co.
const MODEL_REVISIONS: Record<ModelId, string> = {
  'briaai/RMBG-1.4': RMBG_PARAMS.REVISION,
};

/**
 * Supply-chain integrity check for RMBG-1.4. Runs AFTER
 * `transformers.pipeline()` resolves — by then the quantized ONNX
 * lives in the standard browser Cache API (`transformers-cache`).
 * We re-read the cached blob, SHA-256 it, and either accept it or
 * evict the entry and throw so the orchestrator surfaces an error
 * and the next reload re-fetches from upstream.
 *
 * Skips silently if the Cache API is unavailable (e.g. http context,
 * cross-origin restrictions) — verification is best-effort and never
 * blocks a working install.
 */
async function verifyRmbgIntegrity(modelId: ModelId): Promise<void> {
  if (modelId !== 'briaai/RMBG-1.4') return;
  if (typeof caches === 'undefined') return;

  let cache: Cache;
  try {
    cache = await caches.open(RMBG_PARAMS.CACHE_NAME);
  } catch {
    return;
  }

  const resp = await cache.match(RMBG_PARAMS.MODEL_URL);
  if (!resp) {
    console.warn(
      '[NukeBG ML] Model blob not found in transformers cache — integrity check skipped.',
    );
    return;
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength !== RMBG_PARAMS.EXPECTED_SIZE) {
    await cache.delete(RMBG_PARAMS.MODEL_URL);
    throw new Error(
      `RMBG-1.4 model size mismatch: got ${buf.byteLength} bytes, expected ` +
        `${RMBG_PARAMS.EXPECTED_SIZE}. Cache evicted; reload to re-fetch.`,
    );
  }

  const digestBuf = await crypto.subtle.digest('SHA-256', buf);
  const digestHex = Array.from(new Uint8Array(digestBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (digestHex !== RMBG_PARAMS.EXPECTED_SHA256) {
    await cache.delete(RMBG_PARAMS.MODEL_URL);
    throw new Error(
      `RMBG-1.4 hash mismatch: got ${digestHex}, expected ${RMBG_PARAMS.EXPECTED_SHA256}. ` +
        `Cache evicted; reload to re-fetch.`,
    );
  }
}

/** Transformers.js pipeline entry - shape is dynamic from the library */
interface SegmenterEntry {
  pipeline: {
    dispose?: () => void;
    (
      image: unknown,
      opts: unknown,
    ): Promise<Array<{ mask?: { data: Uint8Array; width: number; height: number } }>>;
  };
  type: string;
}

/** Cache segmenters by model ID so switching is instant after first load */
const segmenters = new Map<string, SegmenterEntry>();
let currentModelId: ModelId = DEFAULT_MODEL;
let RawImageClass:
  (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

/** Detect compute device - currently forced to WASM */
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  // Force WASM - WebGPU in Transformers.js is unstable and causes
  // NetworkError on some browsers when loading the WebGPU runtime.
  // Re-enable when Transformers.js WebGPU support is stable.
  return 'wasm';
}

const progressCb = (id: string) => (progress: { status: string; progress?: number }) => {
  if (
    progress.status === 'progress' &&
    progress.progress !== null &&
    progress.progress !== undefined
  ) {
    const pct = 10 + Math.round(progress.progress * 0.8);
    self.postMessage({ id, type: 'model-progress', progress: pct });
  }
  if (progress.status === 'ready') {
    self.postMessage({ id, type: 'model-progress', progress: 95 });
  }
};

async function loadModel(
  id: string,
  modelId: ModelId = DEFAULT_MODEL,
  emitReady = true,
): Promise<void> {
  const device = await detectDevice();

  if (segmenters.has(modelId)) {
    currentModelId = modelId;
    if (emitReady) {
      self.postMessage({ id, type: 'model-progress', progress: 100 });
      self.postMessage({ id, type: 'model-ready', device });
    }
    return;
  }

  // Free previous model to avoid OOM - WASM can't hold multiple models
  for (const [key, entry] of segmenters) {
    if (key !== modelId) {
      // Free previous model to avoid OOM
      try {
        if (entry.pipeline?.dispose) entry.pipeline.dispose();
      } catch {
        /* ignore dispose errors */
      }
      segmenters.delete(key);
    }
  }

  self.postMessage({ id, type: 'model-progress', progress: 5 });

  const transformers = await import('@huggingface/transformers');
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  RawImageClass = transformers.RawImage as unknown as typeof RawImageClass;

  self.postMessage({ id, type: 'model-progress', progress: 10 });

  const seg = await transformers.pipeline('image-segmentation', modelId, {
    device,
    dtype: 'q8',
    revision: MODEL_REVISIONS[modelId],
    progress_callback: progressCb(id),
  });

  // Supply-chain integrity check: verify the cached q8 ONNX bytes match
  // the audited SHA-256 before exposing the pipeline to inference.
  try {
    await verifyRmbgIntegrity(modelId);
  } catch (err) {
    try {
      (seg as unknown as { dispose?: () => void }).dispose?.();
    } catch {
      /* ignore dispose errors */
    }
    throw err;
  }

  segmenters.set(modelId, {
    pipeline: seg as unknown as SegmenterEntry['pipeline'],
    type: 'pipeline',
  });

  // Warmup: run a tiny inference to force WASM full compilation.
  // This ensures consistent results from the very first real image.
  // Wrapped in Promise.race + timeout because on iOS Safari the WASM
  // pipeline has been observed to hang at this step (stuck at 96%).
  self.postMessage({ id, type: 'model-progress', progress: 96 });
  const warmupStart = performance.now();
  // iOS Safari compiles the WASM pipeline substantially slower than
  // desktop Chromium — 15 s was not enough on older iPhones and the
  // warmup timed out, leaving the UI stuck at 96%.
  const warmupTimeoutMs = 45000;
  let warmupDiagnostic: WarmupDiagnostic = {
    status: 'ok',
    elapsedMs: 0,
    device,
    userAgent: typeof self !== 'undefined' && self.navigator ? self.navigator.userAgent : undefined,
    hardwareConcurrency:
      typeof self !== 'undefined' && self.navigator
        ? self.navigator.hardwareConcurrency
        : undefined,
  };
  try {
    if (RawImageClass) {
      const warmupSize = 256;
      const warmupPixels = new Uint8ClampedArray(warmupSize * warmupSize * 4);
      const warmupImg = new RawImageClass(warmupPixels, warmupSize, warmupSize, 4);
      const warmupPromise = (seg as unknown as SegmenterEntry['pipeline'])(warmupImg, {
        threshold: 0.5,
        return_mask: true,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`warmup_timeout_${warmupTimeoutMs}ms`)), warmupTimeoutMs);
      });
      await Promise.race([warmupPromise, timeoutPromise]);
    }
    warmupDiagnostic.elapsedMs = Math.round(performance.now() - warmupStart);
  } catch (err) {
    const e = err as Error;
    const isTimeout = e?.message?.startsWith('warmup_timeout_');
    warmupDiagnostic = {
      ...warmupDiagnostic,
      status: isTimeout ? 'timeout' : 'error',
      elapsedMs: Math.round(performance.now() - warmupStart),
      errorName: e?.name,
      errorMessage: e?.message,
      errorStack: e?.stack,
    };
  }
  self.postMessage({ id, type: 'warmup-diagnostic', diagnostic: warmupDiagnostic });

  currentModelId = modelId;

  if (emitReady) {
    self.postMessage({ id, type: 'model-progress', progress: 100 });
    self.postMessage({ id, type: 'model-ready', device });
  }
}

async function segment(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  modelId: ModelId = DEFAULT_MODEL,
  threshold = 0.5,
  refineOpts?: MlRefineOptions,
): Promise<void> {
  // Use a separate internal ID for auto-loading so that any model-ready
  // message cannot accidentally resolve the pending segment request.
  if (!segmenters.has(modelId)) await loadModel(`_autoload_${id}`, modelId, false);
  const entry = segmenters.get(modelId)!;

  if (!RawImageClass) throw new Error('RawImage class not loaded');
  const image = new RawImageClass(pixels, width, height, 4);

  // Wrap the real inference in a timeout. Warmup has its own timeout, but
  // the first real segment on iOS Safari can still hang (seen: 90s+ stuck)
  // after a successful warmup when heap pressure forces slow GC during
  // tensor allocation. A hard ceiling lets the UI surface an actionable
  // error instead of spinning forever.
  const segmentTimeoutMs = 120000;
  const segmentPromise = entry.pipeline(image, {
    threshold,
    return_mask: true,
  });
  const segmentTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`segment_timeout_${segmentTimeoutMs}ms`)), segmentTimeoutMs);
  });
  const results = await Promise.race([segmentPromise, segmentTimeout]);

  const maskImage = results[0]?.mask;
  if (!maskImage) throw new Error('Model returned no mask');

  const maskData = maskImage.data;
  const maskW = maskImage.width;
  const maskH = maskImage.height;

  const rawAlpha = new Uint8Array(width * height);
  const scaleX = maskW / width;
  const scaleY = maskH / height;
  const useBilinear = refineOpts ? refineOpts.spatialPasses > 0 : true;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!useBilinear) {
        // Nearest-neighbor: fast, used in low-power mode
        const srcX = Math.min(Math.floor(x * scaleX), maskW - 1);
        const srcY = Math.min(Math.floor(y * scaleY), maskH - 1);
        rawAlpha[y * width + x] = maskData[srcY * maskW + srcX];
      } else {
        // Bilinear interpolation: smoother edges, avoids staircase artifacts
        const fx = x * scaleX - 0.5;
        const fy = y * scaleY - 0.5;
        const x0 = Math.max(0, Math.floor(fx));
        const y0 = Math.max(0, Math.floor(fy));
        const x1 = Math.min(x0 + 1, maskW - 1);
        const y1 = Math.min(y0 + 1, maskH - 1);
        const dx = fx - x0;
        const dy = fy - y0;

        const v00 = maskData[y0 * maskW + x0];
        const v10 = maskData[y0 * maskW + x1];
        const v01 = maskData[y1 * maskW + x0];
        const v11 = maskData[y1 * maskW + x1];

        const top = v00 + (v10 - v00) * dx;
        const bot = v01 + (v11 - v01) * dx;
        rawAlpha[y * width + x] = Math.round(top + (bot - top) * dy);
      }
    }
  }

  // Diagnostic: check raw mask value distribution before binarization.
  // A healthy mask has a wide range (0 for bg, 255 for fg). A uniform
  // mask (all values within 5 of each other) indicates corrupt model output.
  let rawMin = 255;
  let rawMax = 0;
  for (let i = 0; i < rawAlpha.length; i++) {
    if (rawAlpha[i] < rawMin) rawMin = rawAlpha[i];
    if (rawAlpha[i] > rawMax) rawMax = rawAlpha[i];
  }

  const totalPx = rawAlpha.length;
  const allSameRange = rawMax - rawMin < 5;
  if (allSameRange && totalPx > 100) {
    console.warn(
      `[NukeBG ML] Suspicious mask: min=${rawMin} max=${rawMax} range=${rawMax - rawMin} - ` +
        `model may have returned uniform output.`,
    );
  }

  // Use the model's soft alpha directly - no binarization.
  // The model produces smooth edges (1-2% edge pixels) that look natural.
  // Binarization was creating artificial contour lines.
  // Light edge cleanup: remove isolated residue pixels only.
  // Core owns the refinement chain (spatial passes -> morphological opening
  // -> small-cluster removal). It used to live here as private helpers, which
  // is why the Node runner had nothing to call and silently skipped it —
  // see issue #327.
  const alphaMask = refineMask(rawAlpha, width, height, refineOpts);

  self.postMessage({ id, type: 'segment-result', result: alphaMask }, [alphaMask.buffer]);
}

self.onmessage = async (e: MessageEvent<MlWorkerRequest>) => {
  // Reject cross-origin postMessage (CodeQL js/missing-origin-check, #187).
  // Empty-origin events are allowed: dedicated Workers receive '' in some
  // browsers; same-origin spawning is enforced by the page's CSP.
  if (e.origin && e.origin !== self.location.origin) return;
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load-model': {
        await loadModel(msg.id, msg.modelId || DEFAULT_MODEL);
        break;
      }
      case 'segment': {
        const { payload } = msg;
        const modelId = msg.modelId || currentModelId;
        const threshold = msg.threshold ?? 0.5;
        await segment(
          msg.id,
          payload.pixels,
          payload.width,
          payload.height,
          modelId,
          threshold,
          msg.refine,
        );
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
