/**
 * ML Worker - Background removal via Transformers.js
 * Uses briaai/RMBG-1.4 through the high-level pipeline API.
 * Transformers.js handles ONNX Runtime, WebGPU/WASM detection,
 * model download, caching — all internally.
 */
import type { MlWorkerRequest, ModelId } from '../types/worker-messages';
import { guidedFilter } from './cv/alpha-matting';

const DEFAULT_MODEL: ModelId = 'briaai/RMBG-1.4';

/** Transformers.js pipeline entry — shape is dynamic from the library */
interface SegmenterEntry {
  pipeline: { dispose?: () => void; (image: unknown, opts: unknown): Promise<Array<{ mask?: { data: Uint8Array; width: number; height: number } }>>; };
  type: string;
}

/** Cache segmenters by model ID so switching is instant after first load */
const segmenters = new Map<string, SegmenterEntry>();
let currentModelId: ModelId = DEFAULT_MODEL;
let RawImageClass: (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

/** Detected compute device — resolved once on first model load */
let resolvedDevice: 'webgpu' | 'wasm' | null = null;

/** Detect WebGPU availability with safe fallback to WASM */
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  if (resolvedDevice) return resolvedDevice;
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown | null> } }).gpu?.requestAdapter();
      if (adapter) {
        resolvedDevice = 'webgpu';
        console.log('[NukeBG] Using WebGPU backend');
        return 'webgpu';
      }
    }
  } catch { /* WebGPU not available — fall through to WASM */ }
  resolvedDevice = 'wasm';
  console.log('[NukeBG] Using WASM backend');
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
): Uint8Array {
  let result = new Uint8Array(alpha);

  // Pass 1: Spatial context with radius 6 (catches larger residue areas)
  result = new Uint8Array(spatialPass(result, w, h, 6));

  // Pass 2: Remove small isolated opaque clusters (<50px) not connected to main subject
  result = new Uint8Array(removeSmallClusters(result, w, h, 50));

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

/** Remove small opaque clusters not connected to the main subject */
function removeSmallClusters(alpha: Uint8Array, w: number, h: number, minSize: number): Uint8Array {
  const result = new Uint8Array(alpha);
  const visited = new Uint8Array(w * h);

  // Find all connected components of opaque pixels (alpha > 30)
  const components: { indices: number[]; size: number }[] = [];

  for (let i = 0; i < w * h; i++) {
    if (alpha[i] <= 30 || visited[i]) continue;

    // BFS flood-fill to find connected component
    const indices: number[] = [];
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
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

  // Remove all components smaller than minSize (and not the main subject)
  for (const comp of components) {
    if (comp.size < minSize && comp.size < maxSize) {
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

  // Free previous model to avoid OOM — WASM can't hold multiple models
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
  // MODNet (6MB) is self-hosted. RMBG-1.4 (42MB) exceeds Cloudflare 25MB limit → HuggingFace CDN.
  const isLocalModel = modelId === 'Xenova/modnet';
  transformers.env.allowLocalModels = isLocalModel;
  transformers.env.localModelPath = '/models/';
  transformers.env.allowRemoteModels = true;
  RawImageClass = transformers.RawImage as unknown as typeof RawImageClass;

  self.postMessage({ id, type: 'model-progress', progress: 10 });

  const seg = await transformers.pipeline('image-segmentation', modelId, {
    device,
    dtype: 'q8',
    progress_callback: progressCb(id),
  });
  segmenters.set(modelId, { pipeline: seg as unknown as SegmenterEntry['pipeline'], type: 'pipeline' });

  // Warmup: run a tiny inference to force WASM full compilation
  // This ensures consistent results from the very first real image
  self.postMessage({ id, type: 'model-progress', progress: 96 });
  try {
    if (RawImageClass) {
      const warmupPixels = new Uint8ClampedArray(16); // 2x2 RGBA
      const warmupImg = new RawImageClass(warmupPixels, 2, 2, 4);
      await (seg as unknown as SegmenterEntry['pipeline'])(warmupImg, { threshold: 0.5, return_mask: true });
    }
  } catch { /* warmup failure is non-critical */ }

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
): Promise<void> {
  if (!segmenters.has(modelId)) await loadModel(id, modelId, false);
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), maskW - 1);
      const srcY = Math.min(Math.floor(y * scaleY), maskH - 1);
      rawAlpha[y * width + x] = maskData[srcY * maskW + srcX];
    }
  }

  const refinedEdges = refineEdges(rawAlpha, pixels, width, height);

  // Apply guided filter for smooth alpha matting at edges
  // Adaptive radius: ~1.5% of smallest dimension, clamped 3-15
  const adaptiveRadius = Math.max(3, Math.min(15, Math.round(Math.min(width, height) * 0.015)));
  const alphaMask = guidedFilter(refinedEdges, pixels, width, height, adaptiveRadius, 1e-4);

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
        await segment(msg.id, payload.pixels, payload.width, payload.height, modelId, threshold);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
