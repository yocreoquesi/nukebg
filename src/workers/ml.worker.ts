/**
 * ML Worker - Background removal via Transformers.js
 * Uses briaai/RMBG-1.4 through the high-level pipeline API.
 * Transformers.js handles ONNX Runtime, WebGPU/WASM detection,
 * model download, caching - all internally.
 */
import type { MlWorkerRequest, MlRefineOptions, ModelId, WarmupDiagnostic } from '../types/worker-messages';
import { REFINE_PARAMS } from '../pipeline/constants';

const DEFAULT_MODEL: ModelId = 'briaai/RMBG-1.4';

// Pin model to a specific revision SHA for supply-chain safety.
// Transformers.js defaults to 'main' branch, which can change silently.
// Pinning guarantees the exact same model weights every load.
// Bump manually after auditing upstream changes on huggingface.co.
const MODEL_REVISIONS: Record<ModelId, string> = {
  'briaai/RMBG-1.4': '2ceba5a5efaec153162aedea169f76caf9b46cf8',
};

/** Transformers.js pipeline entry - shape is dynamic from the library */
interface SegmenterEntry {
  pipeline: { dispose?: () => void; (image: unknown, opts: unknown): Promise<Array<{ mask?: { data: Uint8Array; width: number; height: number } }>>; };
  type: string;
}

/** Cache segmenters by model ID so switching is instant after first load */
const segmenters = new Map<string, SegmenterEntry>();
let currentModelId: ModelId = DEFAULT_MODEL;
let RawImageClass: (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

/** Detect compute device - currently forced to WASM */
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  // Force WASM - WebGPU in Transformers.js is unstable and causes
  // NetworkError on some browsers when loading the WebGPU runtime.
  // Re-enable when Transformers.js WebGPU support is stable.
  return 'wasm';
}

/**
 * Spatial context edge refinement.
 * Removes isolated semi-transparent residue pixels while preserving
 * the subject's outline. Works by checking each edge pixel's neighborhood:
 * - If mostly surrounded by transparent → it's residue → remove
 * - If mostly surrounded by opaque → it's part of the subject → keep
 * This doesn't depend on color, so it works when subject outline
 * matches background color (e.g., dark outline on dark checkerboard).
 */
function refineEdges(
  alpha: Uint8Array,
  _pixels: Uint8ClampedArray,
  w: number,
  h: number,
  opts?: MlRefineOptions,
): Uint8Array {
  const spatialPasses = opts?.spatialPasses ?? 1;
  const spatialRadius = opts?.spatialRadius ?? REFINE_PARAMS.SPATIAL_RADIUS;
  const morphRadius = opts?.morphOpenRadius ?? REFINE_PARAMS.MORPH_OPEN_RADIUS;
  const minCluster = opts?.minClusterSize ?? REFINE_PARAMS.MIN_CLUSTER_SIZE;

  let result = new Uint8Array(alpha);

  // Spatial context passes (catches edge residue areas)
  for (let i = 0; i < spatialPasses; i++) {
    result = new Uint8Array(spatialPass(result, w, h, spatialRadius));
  }

  // Morphological opening (erode + dilate) to clean orphan contour pixels
  if (morphRadius > 0) {
    result = new Uint8Array(morphOpen(result, w, h, morphRadius));
  }

  // Remove isolated opaque clusters not connected to main subject
  result = new Uint8Array(removeSmallClusters(result, w, h, minCluster, opts?.clusterRatio));

  return result;
}

/** Single spatial refinement pass at given radius */
function spatialPass(alpha: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const result = new Uint8Array(alpha);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a < 1 || a > 240) continue;

      let opaqueCount = 0;
      let transparentCount = 0;
      let totalCount = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          totalCount++;
          const na = alpha[ny * w + nx];
          if (na > 200) opaqueCount++;
          else if (na < 30) transparentCount++;
        }
      }

      if (totalCount === 0) continue;

      const transparentRatio = transparentCount / totalCount;
      const opaqueRatio = opaqueCount / totalCount;

      if (transparentRatio > 0.6) {
        result[y * w + x] = 0;
      } else if (opaqueRatio > 0.5) {
        result[y * w + x] = Math.min(255, Math.round(a * 1.3));
      }
    }
  }

  return result;
}

/**
 * Morphological opening (erode then dilate) on binary alpha mask.
 * Erode removes thin protrusions and orphan edge pixels.
 * Dilate restores the main shape to its original size.
 */
function morphOpen(alpha: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const threshold = 128;

  // Erode: pixel is opaque only if ALL neighbors within radius are opaque
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < threshold) continue;
      let allOpaque = true;
      outer:
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) { allOpaque = false; break outer; }
          if (alpha[ny * w + nx] < threshold) { allOpaque = false; break outer; }
        }
      }
      if (allOpaque) eroded[y * w + x] = alpha[y * w + x];
    }
  }

  // Dilate: pixel is opaque if ANY neighbor within radius is opaque in eroded
  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Keep original alpha if already opaque in eroded
      if (eroded[y * w + x] >= threshold) {
        result[y * w + x] = alpha[y * w + x];
        continue;
      }
      // Check if any neighbor in eroded is opaque → restore original alpha
      let hasOpaqueNeighbor = false;
      for (let dy = -radius; dy <= radius && !hasOpaqueNeighbor; dy++) {
        for (let dx = -radius; dx <= radius && !hasOpaqueNeighbor; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && eroded[ny * w + nx] >= threshold) {
            hasOpaqueNeighbor = true;
          }
        }
      }
      result[y * w + x] = hasOpaqueNeighbor ? alpha[y * w + x] : 0;
    }
  }

  return result;
}

/** Remove small opaque clusters not connected to the main subject */
function removeSmallClusters(alpha: Uint8Array, w: number, h: number, minSize: number, clusterRatio?: number): Uint8Array {
  const result = new Uint8Array(alpha);
  const visited = new Uint8Array(w * h);

  // Find all connected components of opaque pixels (alpha > 30)
  const components: { indices: number[]; size: number }[] = [];

  for (let i = 0; i < w * h; i++) {
    if (alpha[i] <= 30 || visited[i]) continue;

    // BFS flood-fill to find connected component (FIFO via head pointer)
    const indices: number[] = [];
    const queue = [i];
    let head = 0;
    visited[i] = 1;

    while (head < queue.length) {
      const idx = queue[head++];
      indices.push(idx);
      const cx = idx % w;
      const cy = (idx - cx) / w;

      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (!visited[ni] && alpha[ni] > 30) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    components.push({ indices, size: indices.length });
  }

  // Find the largest component (= the subject)
  if (components.length === 0) return result;
  const maxSize = Math.max(...components.map(c => c.size));

  // Remove components smaller than CLUSTER_RATIO of the main subject OR below absolute minSize
  const ratio = clusterRatio ?? REFINE_PARAMS.CLUSTER_RATIO;
  const relativeMin = Math.max(minSize, Math.round(maxSize * ratio));
  for (const comp of components) {
    if (comp.size < relativeMin && comp.size < maxSize) {
      for (const idx of comp.indices) {
        result[idx] = 0;
      }
    }
  }

  return result;
}

const progressCb = (id: string) => (progress: { status: string; progress?: number }) => {
  if (progress.status === 'progress' && progress.progress != null) {
    const pct = 10 + Math.round(progress.progress * 0.8);
    self.postMessage({ id, type: 'model-progress', progress: pct });
  }
  if (progress.status === 'ready') {
    self.postMessage({ id, type: 'model-progress', progress: 95 });
  }
};

async function loadModel(id: string, modelId: ModelId = DEFAULT_MODEL, emitReady = true): Promise<void> {
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
      } catch { /* ignore dispose errors */ }
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
  segmenters.set(modelId, { pipeline: seg as unknown as SegmenterEntry['pipeline'], type: 'pipeline' });

  // Warmup: run a tiny inference to force WASM full compilation.
  // This ensures consistent results from the very first real image.
  // Wrapped in Promise.race + timeout because on iOS Safari the WASM
  // pipeline has been observed to hang at this step (stuck at 96%).
  self.postMessage({ id, type: 'model-progress', progress: 96 });
  const warmupStart = performance.now();
  const warmupTimeoutMs = 15000;
  let warmupDiagnostic: WarmupDiagnostic = {
    status: 'ok',
    elapsedMs: 0,
    device,
    userAgent: typeof self !== 'undefined' && (self as any).navigator ? (self as any).navigator.userAgent : undefined,
    hardwareConcurrency: typeof self !== 'undefined' && (self as any).navigator ? (self as any).navigator.hardwareConcurrency : undefined,
  };
  try {
    if (RawImageClass) {
      const warmupSize = 256;
      const warmupPixels = new Uint8ClampedArray(warmupSize * warmupSize * 4);
      const warmupImg = new RawImageClass(warmupPixels, warmupSize, warmupSize, 4);
      const warmupPromise = (seg as unknown as SegmenterEntry['pipeline'])(warmupImg, { threshold: 0.5, return_mask: true });
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

  const results = await entry.pipeline(image, {
    threshold,
    return_mask: true,
  });

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
  const allSameRange = (rawMax - rawMin) < 5;
  if (allSameRange && totalPx > 100) {
    console.warn(
      `[NukeBG ML] Suspicious mask: min=${rawMin} max=${rawMax} range=${rawMax - rawMin} - ` +
      `model may have returned uniform output.`
    );
  }

  // Use the model's soft alpha directly - no binarization.
  // The model produces smooth edges (1-2% edge pixels) that look natural.
  // Binarization was creating artificial contour lines.
  // Light edge cleanup: remove isolated residue pixels only.
  const alphaMask = refineEdges(rawAlpha, pixels, width, height, refineOpts);

  self.postMessage(
    { id, type: 'segment-result', result: alphaMask },
    [alphaMask.buffer],
  );
}

self.onmessage = async (e: MessageEvent<MlWorkerRequest>) => {
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
        await segment(msg.id, payload.pixels, payload.width, payload.height, modelId, threshold, msg.refine);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
