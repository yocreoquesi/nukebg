/**
 * ML Worker - Background removal with InSPyReNet (MIT license).
 * Primary: InSPyReNet Res2Net50 q8 (27MB) via direct ONNX Runtime session.
 * Fallback: RMBG-1.4 (non-commercial, q8, WASM) via Transformers.js pipeline.
 * WebGPU auto-detected for acceleration; WASM as universal fallback.
 */
import type { MlWorkerRequest, ModelId, BackendConfig } from '../types/worker-messages';
import { BACKEND_WEBGPU, BACKEND_WASM, BACKEND_RMBG } from '../types/worker-messages';

/** InSPyReNet q8 model URL - served from GitHub Releases */
const INSPYRENET_MODEL_URL = 'https://github.com/yocreoquesi/nukebg/releases/download/models-v1/inspyrenet_res2net50_q8.onnx';
/** InSPyReNet fixed input resolution */
const INSPYRENET_SIZE = 384;
/** ImageNet normalization constants */
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

// --- Type definitions ---

interface SegmenterEntry {
  pipeline: { dispose?: () => void; (image: unknown, opts: unknown): Promise<Array<{ mask?: { data: Uint8Array; width: number; height: number } }>>; };
  type: 'transformers';
}

interface OnnxSessionEntry {
  session: { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>; release(): void };
  type: 'onnx';
  inputName: string;
}

type ModelEntry = SegmenterEntry | OnnxSessionEntry;

/** Cache loaded models */
const models = new Map<string, ModelEntry>();
let activeConfig: BackendConfig = BACKEND_WASM;
let RawImageClass: (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

/**
 * Detect the best available backend.
 * Tries WebGPU first for acceleration, falls back to WASM.
 */
async function detectBackend(): Promise<BackendConfig> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return BACKEND_WASM;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return BACKEND_WASM;

    const maxBuffer = adapter.limits.maxBufferSize;
    if (maxBuffer < 256 * 1024 * 1024) return BACKEND_WASM;

    const device = await adapter.requestDevice();
    device.destroy();

    return BACKEND_WEBGPU;
  } catch {
    return BACKEND_WASM;
  }
}

// ============================================================
// Edge refinement (shared by all models)
// ============================================================

function refineEdges(
  alpha: Uint8Array,
  _pixels: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array {
  let result = new Uint8Array(alpha);
  result = new Uint8Array(spatialPass(result, w, h, 6));
  result = new Uint8Array(removeSmallClusters(result, w, h, 50));
  return result;
}

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

function removeSmallClusters(alpha: Uint8Array, w: number, h: number, minSize: number): Uint8Array {
  const result = new Uint8Array(alpha);
  const visited = new Uint8Array(w * h);

  const components: { indices: number[]; size: number }[] = [];

  for (let i = 0; i < w * h; i++) {
    if (alpha[i] <= 30 || visited[i]) continue;

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

  if (components.length === 0) return result;
  const maxSize = Math.max(...components.map(c => c.size));

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

// ============================================================
// InSPyReNet: direct ONNX Runtime session
// ============================================================

async function fetchModelWithProgress(id: string, url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch model: ${response.status}`);

  const contentLength = response.headers.get('content-length');
  if (!contentLength || !response.body) {
    return response.arrayBuffer();
  }

  const total = parseInt(contentLength, 10);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = 10 + Math.round((received / total) * 70);
    self.postMessage({ id, type: 'model-progress', progress: pct });
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.buffer;
}

async function loadInspyrenet(id: string, device: 'webgpu' | 'wasm'): Promise<void> {
  self.postMessage({ id, type: 'model-progress', progress: 5 });

  const ort = await import('onnxruntime-web');

  self.postMessage({ id, type: 'model-progress', progress: 8 });

  const modelBuffer = await fetchModelWithProgress(id, INSPYRENET_MODEL_URL);

  self.postMessage({ id, type: 'model-progress', progress: 85 });

  const sessionOptions = {
    executionProviders: device === 'webgpu'
      ? [{ name: 'webgpu' as const, preferredLayout: 'NHWC' as const }]
      : ['wasm' as const],
  };

  const session = await ort.InferenceSession.create(modelBuffer, sessionOptions);

  // Discover input name (varies between fp16 and q8 exports)
  const inputName = session.inputNames[0];

  self.postMessage({ id, type: 'model-progress', progress: 90 });

  // Warmup
  try {
    const warmupData = new Float32Array(1 * 3 * INSPYRENET_SIZE * INSPYRENET_SIZE);
    const warmupTensor = new ort.Tensor('float32', warmupData, [1, 3, INSPYRENET_SIZE, INSPYRENET_SIZE]);
    await session.run({ [inputName]: warmupTensor });
  } catch { /* warmup failure is non-critical */ }

  models.set('inspyrenet', {
    session: session as unknown as OnnxSessionEntry['session'],
    type: 'onnx',
    inputName,
  });
}

function preprocessInspyrenet(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const size = INSPYRENET_SIZE;
  const tensor = new Float32Array(1 * 3 * size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.min(Math.floor(x * width / size), width - 1);
      const srcY = Math.min(Math.floor(y * height / size), height - 1);
      const si = (srcY * width + srcX) * 4;

      const r = pixels[si] / 255;
      const g = pixels[si + 1] / 255;
      const b = pixels[si + 2] / 255;

      const idx = y * size + x;
      tensor[0 * size * size + idx] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
      tensor[1 * size * size + idx] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
      tensor[2 * size * size + idx] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
  }

  return tensor;
}

async function runInspyrenet(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const entry = models.get('inspyrenet') as OnnxSessionEntry;
  const ort = await import('onnxruntime-web');

  const inputData = preprocessInspyrenet(pixels, width, height);
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INSPYRENET_SIZE, INSPYRENET_SIZE]);

  const results = await entry.session.run({ [entry.inputName]: inputTensor });
  const outputKey = Object.keys(results)[0];
  const outputData = results[outputKey].data as Float32Array;

  const maskSize = INSPYRENET_SIZE;
  const alpha = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * maskSize / width), maskSize - 1);
      const srcY = Math.min(Math.floor(y * maskSize / height), maskSize - 1);
      const val = outputData[srcY * maskSize + srcX];
      alpha[y * width + x] = Math.round(Math.max(0, Math.min(1, val)) * 255);
    }
  }

  return alpha;
}

// ============================================================
// RMBG-1.4: Transformers.js pipeline (last resort fallback)
// ============================================================

async function loadRmbg(id: string): Promise<void> {
  self.postMessage({ id, type: 'model-progress', progress: 5 });

  const transformers = await import('@huggingface/transformers');
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  RawImageClass = transformers.RawImage as unknown as typeof RawImageClass;

  self.postMessage({ id, type: 'model-progress', progress: 10 });

  const seg = await transformers.pipeline('image-segmentation', 'briaai/RMBG-1.4', {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: progressCb(id),
  });

  models.set('briaai/RMBG-1.4', {
    pipeline: seg as unknown as SegmenterEntry['pipeline'],
    type: 'transformers',
  });

  self.postMessage({ id, type: 'model-progress', progress: 96 });
  try {
    if (RawImageClass) {
      const warmupPixels = new Uint8ClampedArray(256 * 256 * 4);
      const warmupImg = new RawImageClass(warmupPixels, 256, 256, 4);
      await (seg as unknown as SegmenterEntry['pipeline'])(warmupImg, { threshold: 0.5, return_mask: true });
    }
  } catch { /* warmup failure is non-critical */ }
}

async function runRmbg(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Promise<Uint8Array> {
  const entry = models.get('briaai/RMBG-1.4') as SegmenterEntry;

  if (!RawImageClass) throw new Error('RawImage class not loaded');
  const image = new RawImageClass(pixels, width, height, 4);

  const results = await entry.pipeline(image, { threshold, return_mask: true });
  const maskImage = results[0]?.mask;
  if (!maskImage) throw new Error('Model returned no mask');

  const maskData = maskImage.data;
  const maskW = maskImage.width;
  const maskH = maskImage.height;

  const alpha = new Uint8Array(width * height);
  const scaleX = maskW / width;
  const scaleY = maskH / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), maskW - 1);
      const srcY = Math.min(Math.floor(y * scaleY), maskH - 1);
      alpha[y * width + x] = maskData[srcY * maskW + srcX];
    }
  }

  return alpha;
}

// ============================================================
// Unified load / segment / fallback
// ============================================================

async function loadModel(id: string, config: BackendConfig = activeConfig, emitReady = true): Promise<void> {
  const { modelId, device, label } = config;

  if (models.has(modelId)) {
    activeConfig = config;
    if (emitReady) {
      self.postMessage({ id, type: 'model-progress', progress: 100 });
      self.postMessage({ id, type: 'model-ready', device, modelLabel: label });
    }
    return;
  }

  // Free previous model to avoid OOM
  for (const [key, entry] of models) {
    if (key !== modelId) {
      try {
        if (entry.type === 'onnx') entry.session.release();
        else if (entry.pipeline?.dispose) entry.pipeline.dispose();
      } catch { /* ignore dispose errors */ }
      models.delete(key);
    }
  }

  if (modelId === 'inspyrenet') {
    await loadInspyrenet(id, device);
  } else {
    await loadRmbg(id);
  }

  activeConfig = config;

  if (emitReady) {
    self.postMessage({ id, type: 'model-progress', progress: 100 });
    self.postMessage({ id, type: 'model-ready', device, modelLabel: label });
  }
}

async function segment(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  _modelId: ModelId = activeConfig.modelId,
  threshold = 0.5,
): Promise<void> {
  if (!models.has(activeConfig.modelId)) {
    await loadModel(`_autoload_${id}`, activeConfig, false);
  }

  let rawAlpha: Uint8Array;

  try {
    if (activeConfig.modelId === 'inspyrenet') {
      rawAlpha = await runInspyrenet(pixels, width, height);
    } else {
      rawAlpha = await runRmbg(pixels, width, height, threshold);
    }
  } catch (err) {
    // Any failure from primary model: try next fallback
    if (activeConfig.modelId === 'inspyrenet') {
      const reason = String(err).slice(0, 120);

      if (activeConfig.device === 'webgpu') {
        // WebGPU InSPyReNet failed → try WASM InSPyReNet
        await fallbackTo(id, BACKEND_WASM, reason);
        try {
          rawAlpha = await runInspyrenet(pixels, width, height);
        } catch {
          // WASM InSPyReNet also failed → last resort: RMBG
          await fallbackTo(id, BACKEND_RMBG, 'InSPyReNet WASM also failed');
          rawAlpha = await runRmbg(pixels, width, height, threshold);
        }
      } else {
        // WASM InSPyReNet failed → last resort: RMBG
        await fallbackTo(id, BACKEND_RMBG, reason);
        rawAlpha = await runRmbg(pixels, width, height, threshold);
      }
    } else {
      throw err;
    }
  }

  // Diagnostic
  let rawMin = 255;
  let rawMax = 0;
  for (let i = 0; i < rawAlpha.length; i++) {
    if (rawAlpha[i] < rawMin) rawMin = rawAlpha[i];
    if (rawAlpha[i] > rawMax) rawMax = rawAlpha[i];
  }

  const allSameRange = (rawMax - rawMin) < 5;
  if (allSameRange && rawAlpha.length > 100) {
    console.warn(
      `[NukeBG ML] Suspicious mask: min=${rawMin} max=${rawMax} range=${rawMax - rawMin} - ` +
      `model may have returned uniform output.`
    );
  }

  const alphaMask = refineEdges(rawAlpha, pixels, width, height);

  self.postMessage(
    { id, type: 'segment-result', result: alphaMask },
    [alphaMask.buffer],
  );
}

/** Switch to a different backend config */
async function fallbackTo(id: string, config: BackendConfig, reason: string): Promise<void> {
  // Dispose current model
  for (const [k, e] of models) {
    try {
      if (e.type === 'onnx') e.session.release();
      else e.pipeline?.dispose?.();
    } catch { /* ignore */ }
    models.delete(k);
  }

  self.postMessage({
    id,
    type: 'backend-fallback',
    from: activeConfig.label,
    to: config.label,
    reason,
  });

  activeConfig = config;
  await loadModel(id, config);
}

self.onmessage = async (e: MessageEvent<MlWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load-model': {
        const config = await detectBackend();
        activeConfig = config;

        try {
          await loadModel(msg.id, config);
        } catch (loadErr) {
          // Primary failed to load → cascade fallback
          const reason = String(loadErr).slice(0, 120);

          if (config.device === 'webgpu') {
            // WebGPU failed → try WASM InSPyReNet
            try {
              await fallbackTo(msg.id, BACKEND_WASM, reason);
            } catch {
              // WASM InSPyReNet failed → RMBG
              await fallbackTo(msg.id, BACKEND_RMBG, 'InSPyReNet unavailable');
            }
          } else if (config.modelId === 'inspyrenet') {
            // WASM InSPyReNet failed → RMBG
            await fallbackTo(msg.id, BACKEND_RMBG, reason);
          } else {
            throw loadErr;
          }
        }
        break;
      }
      case 'segment': {
        const { payload } = msg;
        const threshold = msg.threshold ?? 0.5;
        await segment(msg.id, payload.pixels, payload.width, payload.height, activeConfig.modelId, threshold);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
