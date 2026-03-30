/**
 * ML Worker - Background removal via Transformers.js
 * Dual-backend: WebGPU + BiRefNet-lite (fp16) with WASM + RMBG-1.4 (q8) fallback.
 * Transformers.js handles ONNX Runtime, WebGPU/WASM detection,
 * model download, caching - all internally.
 */
import type { MlWorkerRequest, ModelId, BackendConfig } from '../types/worker-messages';
import { BACKEND_WEBGPU, BACKEND_WASM } from '../types/worker-messages';

/** Transformers.js pipeline entry - shape is dynamic from the library */
interface SegmenterEntry {
  pipeline: { dispose?: () => void; (image: unknown, opts: unknown): Promise<Array<{ mask?: { data: Uint8Array; width: number; height: number } }>>; };
  type: string;
}

/** Cache segmenters by model ID so switching is instant after first load */
const segmenters = new Map<string, SegmenterEntry>();
let activeConfig: BackendConfig = BACKEND_WASM;
let RawImageClass: (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

/** Max inference resolution for WebGPU to stay within VRAM limits */
const WEBGPU_MAX_SIZE = 512;

/**
 * BiRefNet-lite Pad node names that must run on CPU.
 * WebGPU's Pad shader compilation fails for these nodes.
 * Extracted from onnx-community/BiRefNet_lite-ONNX model_fp16.onnx.
 */
const BIREFNET_PAD_NODES: readonly string[] = [
  '/bb/layers.0/blocks.0/Pad', '/bb/layers.0/blocks.1/Pad',
  '/bb/layers.1/blocks.0/Pad', '/bb/layers.1/blocks.1/Pad',
  '/bb/layers.2/blocks.0/Pad', '/bb/layers.2/blocks.1/Pad',
  '/bb/layers.2/blocks.2/Pad', '/bb/layers.2/blocks.3/Pad',
  '/bb/layers.2/blocks.4/Pad', '/bb/layers.2/blocks.5/Pad',
  '/bb/layers.3/blocks.0/Pad', '/bb/layers.3/blocks.1/Pad',
  '/bb/layers.0/blocks.0_1/Pad', '/bb/layers.0/blocks.1_1/Pad',
  '/bb/layers.1/blocks.0_1/Pad', '/bb/layers.1/blocks.1_1/Pad',
  '/bb/layers.2/blocks.0_1/Pad', '/bb/layers.2/blocks.1_1/Pad',
  '/bb/layers.2/blocks.2_1/Pad', '/bb/layers.2/blocks.3_1/Pad',
  '/bb/layers.2/blocks.4_1/Pad', '/bb/layers.2/blocks.5_1/Pad',
  '/bb/layers.3/blocks.0_1/Pad', '/bb/layers.3/blocks.1_1/Pad',
  '/squeeze_module/squeeze_module.0/dec_att/aspp1/atrous_conv/Pad',
  '/squeeze_module/squeeze_module.0/dec_att/aspp_deforms.0/atrous_conv/Pad',
  '/squeeze_module/squeeze_module.0/dec_att/aspp_deforms.1/atrous_conv/Pad',
  '/squeeze_module/squeeze_module.0/dec_att/aspp_deforms.2/atrous_conv/Pad',
  '/decoder/decoder_block4/dec_att/aspp1/atrous_conv/Pad',
  '/decoder/decoder_block4/dec_att/aspp_deforms.0/atrous_conv/Pad',
  '/decoder/decoder_block4/dec_att/aspp_deforms.1/atrous_conv/Pad',
  '/decoder/decoder_block4/dec_att/aspp_deforms.2/atrous_conv/Pad',
  '/decoder/decoder_block3/dec_att/aspp1/atrous_conv/Pad',
  '/decoder/decoder_block3/dec_att/aspp_deforms.0/atrous_conv/Pad',
  '/decoder/decoder_block3/dec_att/aspp_deforms.1/atrous_conv/Pad',
  '/decoder/decoder_block3/dec_att/aspp_deforms.2/atrous_conv/Pad',
  '/decoder/decoder_block2/dec_att/aspp1/atrous_conv/Pad',
  '/decoder/decoder_block2/dec_att/aspp_deforms.0/atrous_conv/Pad',
  '/decoder/decoder_block2/dec_att/aspp_deforms.1/atrous_conv/Pad',
  '/decoder/decoder_block2/dec_att/aspp_deforms.2/atrous_conv/Pad',
  '/decoder/decoder_block1/dec_att/aspp1/atrous_conv/Pad',
  '/decoder/decoder_block1/dec_att/aspp_deforms.0/atrous_conv/Pad',
  '/decoder/decoder_block1/dec_att/aspp_deforms.1/atrous_conv/Pad',
  '/decoder/decoder_block1/dec_att/aspp_deforms.2/atrous_conv/Pad',
];

/**
 * Detect the best available backend.
 * Tries WebGPU first (for BiRefNet fp16), falls back to WASM (for RMBG q8).
 */
async function detectBackend(): Promise<BackendConfig> {
  // Check WebGPU availability in worker scope
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return BACKEND_WASM;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return BACKEND_WASM;

    // Check minimum buffer size (~256MB) as VRAM proxy
    const maxBuffer = adapter.limits.maxBufferSize;
    if (maxBuffer < 256 * 1024 * 1024) return BACKEND_WASM;

    // Confirm device can be created
    const device = await adapter.requestDevice();
    device.destroy();

    return BACKEND_WEBGPU;
  } catch {
    return BACKEND_WASM;
  }
}

/**
 * Spatial context edge refinement.
 * Removes isolated semi-transparent residue pixels while preserving
 * the subject's outline. Works by checking each edge pixel's neighborhood:
 * - If mostly surrounded by transparent -> it's residue -> remove
 * - If mostly surrounded by opaque -> it's part of the subject -> keep
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

/**
 * Downscale pixels for WebGPU inference to fit VRAM.
 * Returns downscaled pixels + dimensions, or original if already small enough.
 */
function downscaleForInference(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxSize: number,
): { pixels: Uint8ClampedArray; width: number; height: number; scaled: boolean } {
  if (width <= maxSize && height <= maxSize) {
    return { pixels, width, height, scaled: false };
  }

  const scale = maxSize / Math.max(width, height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);
  const out = new Uint8ClampedArray(newW * newH * 4);

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(Math.floor(x / scale), width - 1);
      const srcY = Math.min(Math.floor(y / scale), height - 1);
      const si = (srcY * width + srcX) * 4;
      const di = (y * newW + x) * 4;
      out[di] = pixels[si];
      out[di + 1] = pixels[si + 1];
      out[di + 2] = pixels[si + 2];
      out[di + 3] = pixels[si + 3];
    }
  }

  return { pixels: out, width: newW, height: newH, scaled: true };
}

async function loadModel(id: string, config: BackendConfig = activeConfig, emitReady = true): Promise<void> {
  const { modelId, device, dtype, label } = config;

  if (segmenters.has(modelId)) {
    activeConfig = config;
    if (emitReady) {
      self.postMessage({ id, type: 'model-progress', progress: 100 });
      self.postMessage({ id, type: 'model-ready', device, modelLabel: label });
    }
    return;
  }

  // Free previous model to avoid OOM - only one model in memory at a time
  for (const [key, entry] of segmenters) {
    if (key !== modelId) {
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

  // For WebGPU + BiRefNet: force Pad nodes to CPU to avoid shader compilation failures
  const pipelineOpts: Record<string, unknown> = {
    device,
    dtype,
    progress_callback: progressCb(id),
  };
  if (device === 'webgpu' && modelId === 'onnx-community/BiRefNet_lite-ONNX') {
    pipelineOpts.session_options = {
      executionProviders: [{
        name: 'webgpu',
        preferredLayout: 'NHWC',
        forceCpuNodeNames: BIREFNET_PAD_NODES,
      }],
    };
  }

  const seg = await transformers.pipeline('image-segmentation', modelId, pipelineOpts);
  segmenters.set(modelId, { pipeline: seg as unknown as SegmenterEntry['pipeline'], type: 'pipeline' });

  // Warmup: run a tiny inference to force full compilation
  self.postMessage({ id, type: 'model-progress', progress: 96 });
  try {
    if (RawImageClass) {
      const warmupSize = 256;
      const warmupPixels = new Uint8ClampedArray(warmupSize * warmupSize * 4);
      const warmupImg = new RawImageClass(warmupPixels, warmupSize, warmupSize, 4);
      await (seg as unknown as SegmenterEntry['pipeline'])(warmupImg, { threshold: 0.5, return_mask: true });
    }
  } catch { /* warmup failure is non-critical */ }

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
  modelId: ModelId = activeConfig.modelId,
  threshold = 0.5,
): Promise<void> {
  // Auto-load if needed
  if (!segmenters.has(modelId)) {
    await loadModel(`_autoload_${id}`, activeConfig, false);
  }

  // Downscale for WebGPU to fit VRAM
  const inferenceInput = activeConfig.device === 'webgpu'
    ? downscaleForInference(pixels, width, height, WEBGPU_MAX_SIZE)
    : { pixels, width, height, scaled: false };

  const entry = segmenters.get(activeConfig.modelId)!;

  if (!RawImageClass) throw new Error('RawImage class not loaded');
  const image = new RawImageClass(inferenceInput.pixels, inferenceInput.width, inferenceInput.height, 4);

  let results: Array<{ mask?: { data: Uint8Array; width: number; height: number } }>;
  try {
    results = await entry.pipeline(image, {
      threshold,
      return_mask: true,
    });
  } catch (err) {
    // WebGPU failure: fall back to WASM + RMBG
    if (isWebGpuError(err) && activeConfig.device === 'webgpu') {
      await fallbackToWasm(id, 'GPU inference failed');

      // Retry with WASM (no downscale needed)
      const wasmEntry = segmenters.get(BACKEND_WASM.modelId)!;
      if (!RawImageClass) throw new Error('RawImage class not loaded');
      const wasmImage = new RawImageClass(pixels, width, height, 4);
      results = await wasmEntry.pipeline(wasmImage, { threshold, return_mask: true });
    } else {
      throw err;
    }
  }

  const maskImage = results[0]?.mask;
  if (!maskImage) throw new Error('Model returned no mask');

  const maskData = maskImage.data;
  const maskW = maskImage.width;
  const maskH = maskImage.height;

  // Always map mask back to ORIGINAL dimensions (not inference dimensions)
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

  // Diagnostic: check raw mask value distribution before binarization.
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
  const alphaMask = refineEdges(rawAlpha, pixels, width, height);

  self.postMessage(
    { id, type: 'segment-result', result: alphaMask },
    [alphaMask.buffer],
  );
}

/** Check if an error is a WebGPU-related failure */
function isWebGpuError(err: unknown): boolean {
  return /lost|oom|out of memory|bad_alloc|device lost|allocation|abort|shader|pipeline|webgpu|non-zero status/i.test(String(err));
}

/** Attempt to fall back from WebGPU to WASM */
async function fallbackToWasm(id: string, reason: string): Promise<void> {
  // Dispose any broken WebGPU sessions
  for (const [k, e] of segmenters) {
    try { e.pipeline?.dispose?.(); } catch { /* ignore */ }
    segmenters.delete(k);
  }

  self.postMessage({
    id,
    type: 'backend-fallback',
    from: activeConfig.label,
    to: BACKEND_WASM.label,
    reason,
  });

  activeConfig = BACKEND_WASM;
  await loadModel(id, BACKEND_WASM);
}

self.onmessage = async (e: MessageEvent<MlWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load-model': {
        // Detect best backend on first load
        const config = await detectBackend();
        activeConfig = config;

        try {
          await loadModel(msg.id, config);
        } catch (loadErr) {
          // WebGPU model failed to load (shader compilation, etc.) -> fallback
          if (config.device === 'webgpu' && isWebGpuError(loadErr)) {
            await fallbackToWasm(msg.id, 'WebGPU model failed to load');
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
