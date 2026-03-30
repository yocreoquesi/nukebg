/**
 * ML Worker - Background removal via InSPyReNet (MIT license).
 * Single model: InSPyReNet Res2Net50 q8 (27MB) on WASM.
 * Direct ONNX Runtime session — no Transformers.js dependency.
 */
import type { MlWorkerRequest } from '../types/worker-messages';
import { BACKEND_CONFIG } from '../types/worker-messages';

/** InSPyReNet q8 model URL - served from GitHub Releases */
const MODEL_URL = 'https://github.com/yocreoquesi/nukebg/releases/download/models-v1/inspyrenet_res2net50_q8.onnx';
/** InSPyReNet fixed input resolution */
const INPUT_SIZE = 384;
/** ImageNet normalization constants */
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

/** ONNX Runtime session */
let session: { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>; release(): void } | null = null;
let inputName = 'input';

// ============================================================
// Edge refinement
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

// ============================================================
// Model loading and inference
// ============================================================

async function fetchModelWithProgress(id: string): Promise<ArrayBuffer> {
  const response = await fetch(MODEL_URL);
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

async function loadModel(id: string): Promise<void> {
  if (session) {
    self.postMessage({ id, type: 'model-progress', progress: 100 });
    self.postMessage({ id, type: 'model-ready', modelLabel: BACKEND_CONFIG.label });
    return;
  }

  self.postMessage({ id, type: 'model-progress', progress: 5 });

  const ort = await import('onnxruntime-web');

  self.postMessage({ id, type: 'model-progress', progress: 8 });

  const modelBuffer = await fetchModelWithProgress(id);

  self.postMessage({ id, type: 'model-progress', progress: 85 });

  const sess = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
  });

  inputName = sess.inputNames[0];
  session = sess as unknown as typeof session;

  self.postMessage({ id, type: 'model-progress', progress: 90 });

  // Warmup
  try {
    const warmupData = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
    const warmupTensor = new ort.Tensor('float32', warmupData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    await sess.run({ [inputName]: warmupTensor });
  } catch { /* warmup failure is non-critical */ }

  self.postMessage({ id, type: 'model-progress', progress: 100 });
  self.postMessage({ id, type: 'model-ready', modelLabel: BACKEND_CONFIG.label });
}

function preprocess(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const size = INPUT_SIZE;
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

async function segment(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 0.5,
): Promise<void> {
  if (!session) {
    await loadModel(`_autoload_${id}`);
  }

  const ort = await import('onnxruntime-web');
  const inputData = preprocess(pixels, width, height);
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const results = await session!.run({ [inputName]: inputTensor });
  const outputKey = Object.keys(results)[0];
  const outputData = results[outputKey].data as Float32Array;

  // Map model output (1x1x384x384, values 0-1) back to original dimensions
  const maskSize = INPUT_SIZE;
  const rawAlpha = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * maskSize / width), maskSize - 1);
      const srcY = Math.min(Math.floor(y * maskSize / height), maskSize - 1);
      const val = outputData[srcY * maskSize + srcX];
      rawAlpha[y * width + x] = Math.round(Math.max(0, Math.min(1, val)) * 255);
    }
  }

  // Apply threshold for binary segmentation
  if (threshold < 1) {
    const t = Math.round(threshold * 255);
    for (let i = 0; i < rawAlpha.length; i++) {
      rawAlpha[i] = rawAlpha[i] >= t ? 255 : 0;
    }
  }

  // Diagnostic
  let rawMin = 255;
  let rawMax = 0;
  for (let i = 0; i < rawAlpha.length; i++) {
    if (rawAlpha[i] < rawMin) rawMin = rawAlpha[i];
    if (rawAlpha[i] > rawMax) rawMax = rawAlpha[i];
  }

  if ((rawMax - rawMin) < 5 && rawAlpha.length > 100) {
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

// ============================================================
// Message handler
// ============================================================

self.onmessage = async (e: MessageEvent<MlWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load-model':
        await loadModel(msg.id);
        break;
      case 'segment': {
        const { payload } = msg;
        const threshold = msg.threshold ?? 0.5;
        await segment(msg.id, payload.pixels, payload.width, payload.height, threshold);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
