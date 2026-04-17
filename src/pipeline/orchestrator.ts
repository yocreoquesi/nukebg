import type {
  PipelineStage,
  StageStatus,
  PipelineResult,
  BgColorResult,
  WatermarkResult,
  ImageContentType,
} from '../types/pipeline';
import type { CvWorkerResponse, MlWorkerResponse, InpaintWorkerResponse, LamaWorkerResponse, ModelId, ClassifyImageResult } from '../types/worker-messages';
import { IMAGE_CLASSIFY_PARAMS, INPAINT_PARAMS, PRECISION_PROFILES } from './constants';
import type { PrecisionMode } from './constants';
import { compositeWithFeather, dilateMask } from '../workers/cv/inpaint-blend';
import { shouldUseLama } from '../workers/cv/lama-router';

type StageCallback = (stage: PipelineStage, status: StageStatus, message?: string) => void;

/** Fallback UUID generator for browsers that don't support crypto.randomUUID (Safari <15.4) */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: RFC4122-compliant v4 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Worker call timeout in ms */
const CV_TIMEOUT_MS = 60_000;
/** ML timeout is longer: model download can take time on first use */
const ML_TIMEOUT_MS = 300_000;
/** Inpaint timeout: PatchMatch CV is instant, 30s is more than enough */
const INPAINT_TIMEOUT_MS = 30_000;
/** LaMa timeout: first call downloads the ~95MB ONNX model over CDN,
 *  then runs Fourier-convolution inference on WASM. 5 min covers the
 *  worst-case cold start on a slow connection. */
const LAMA_TIMEOUT_MS = 300_000;

export class PipelineOrchestrator {
  private cvWorker: Worker;
  private mlWorker: Worker;
  private inpaintWorker: Worker | null = null;
  private lamaWorker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void; expectedType: string }>();
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private onStageChange: StageCallback;

  constructor(onStageChange: StageCallback) {
    this.onStageChange = onStageChange;

    this.cvWorker = new Worker(
      new URL('../workers/cv.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.mlWorker = new Worker(
      new URL('../workers/ml.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.cvWorker.onerror = (e) => {
      this.rejectAllPending(`CV Worker error: ${e.message}`);
      this.cvWorker.terminate();
    };
    this.mlWorker.onerror = (e) => {
      this.rejectAllPending(`ML Worker error: ${e.message}`);
      this.mlWorker.terminate();
    };

    this.cvWorker.onmessage = (e: MessageEvent<CvWorkerResponse>) => {
      const msg = e.data;
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.type === 'error') {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    };

    this.setupMlWorkerHandler();
  }

  /** Whether to suppress ML progress updates (during background preload) */
  private suppressMlProgress = false;

  /** Attach onmessage handler to the current mlWorker */
  private setupMlWorkerHandler(): void {
    this.mlWorker.onmessage = (e: MessageEvent<MlWorkerResponse>) => {
      const msg = e.data;
      // model-progress events: forward to UI, don't resolve the pending request
      if (msg.type === 'model-progress') {
        if (this.suppressMlProgress) return; // background preload, don't update UI
        const pct = msg.progress ?? 0;
        const label = pct >= 96 && pct < 100
          ? 'Warming up the reactor... [96%]'
          : `Loading AI model... ${pct}% [${pct}%]`;
        this.emit('ml-segmentation', 'running', label);
        return;
      }

      // warmup-diagnostic: surface iOS Safari hang info to console for remote debugging
      if (msg.type === 'warmup-diagnostic') {
        const d = msg.diagnostic;
        const tag = '[NukeBG/warmup]';
        if (d.status === 'ok') {
          console.info(`${tag} ok ${d.elapsedMs}ms (device=${d.device})`);
        } else {
          console.warn(`${tag} ${d.status} after ${d.elapsedMs}ms`, {
            device: d.device,
            errorName: d.errorName,
            errorMessage: d.errorMessage,
            errorStack: d.errorStack,
            userAgent: d.userAgent,
            hardwareConcurrency: d.hardwareConcurrency,
          });
        }
        return;
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'error') {
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.type === 'segment-result') {
          // Only resolve if the request was actually for a segment call
          if (pending.expectedType !== 'segment') {
            console.warn(`[NukeBG] segment-result arrived for a '${pending.expectedType}' request - ignoring`);
            return;
          }
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        } else if (msg.type === 'model-ready') {
          // Only resolve if the request was for load-model, NOT segment.
          // This prevents a model-ready message from prematurely resolving
          // a segment request when the worker auto-loads the model.
          if (pending.expectedType !== 'load-model') {
            console.warn(`[NukeBG] model-ready arrived for a '${pending.expectedType}' request - ignoring`);
            return;
          }
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg);
        }
      }
    };
  }

  /** Extract Transferable buffers from a payload object */
  private static extractTransferables(payload: Record<string, unknown> | undefined): Transferable[] {
    if (!payload) return [];
    const transferables: Transferable[] = [];
    for (const val of Object.values(payload)) {
      if (val instanceof ArrayBuffer) {
        transferables.push(val);
      } else if (ArrayBuffer.isView(val) && val.buffer instanceof ArrayBuffer) {
        transferables.push(val.buffer);
      }
    }
    return transferables;
  }

  /** Reject all pending requests (used when a worker crashes) */
  private rejectAllPending(message: string): void {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(message));
    }
    this.pendingRequests.clear();
  }

  private cvCall<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject, expectedType: type });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.cvWorker.postMessage({ id, type, payload }, transferables);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`CV Worker timeout after ${CV_TIMEOUT_MS}ms: ${type}`));
        }
      }, CV_TIMEOUT_MS);
      this.pendingTimers.add(timer);
    });
  }

  private mlCall<T>(type: string, payload?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject, expectedType: type });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.mlWorker.postMessage({ id, type, payload, ...extra }, transferables);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`ML Worker timeout after ${ML_TIMEOUT_MS}ms: ${type}. Check browser console for errors.`));
        }
      }, ML_TIMEOUT_MS);
      this.pendingTimers.add(timer);
    });
  }

  /** Create the inpaint worker lazily (only when needed) */
  private createInpaintWorker(): void {
    if (this.inpaintWorker) return;
    this.inpaintWorker = new Worker(
      new URL('../workers/inpaint.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.inpaintWorker.onerror = (e) => this.rejectAllPending(`Inpaint Worker error: ${e.message}`);
    this.inpaintWorker.onmessage = (e: MessageEvent<InpaintWorkerResponse>) => {
      const msg = e.data;

      // Progress events: forward to UI
      if (msg.type === 'inpaint-progress') {
        const label = 'Reconstructing watermark area...';
        this.emit('inpaint', 'running', label);
        return;
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'error') {
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.type === 'inpaint-result') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        } else if (msg.type === 'disposed') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(undefined);
        }
      }
    };
  }

  private inpaintCall<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this.inpaintWorker) throw new Error('Inpaint worker not created');
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject, expectedType: type });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.inpaintWorker!.postMessage({ id, type, payload }, transferables);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Inpaint Worker timeout after ${INPAINT_TIMEOUT_MS}ms: ${type}`));
        }
      }, INPAINT_TIMEOUT_MS);
      this.pendingTimers.add(timer);
    });
  }

  /** Dispose inpaint worker and free memory */
  private disposeInpaintWorker(): void {
    if (this.inpaintWorker) {
      this.inpaintWorker.terminate();
      this.inpaintWorker = null;
    }
  }

  /** Create the LaMa worker lazily (only when the router picks it). */
  private createLamaWorker(): void {
    if (this.lamaWorker) return;
    this.lamaWorker = new Worker(
      new URL('../workers/lama.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.lamaWorker.onerror = (e) => this.rejectAllPending(`LaMa Worker error: ${e.message}`);
    this.lamaWorker.onmessage = (e: MessageEvent<LamaWorkerResponse>) => {
      const msg = e.data;

      // Model download progress: forward to UI, don't resolve the pending request.
      if (msg.type === 'lama-model-progress') {
        const pct = msg.progress;
        this.emit('inpaint', 'running', `Loading AI inpainting model... ${pct}% [${pct}%]`);
        return;
      }
      if (msg.type === 'lama-model-ready') {
        this.emit('inpaint', 'running', 'Reconstructing zone [AI]...');
        return;
      }
      if (msg.type === 'lama-inpaint-progress') {
        // Stage strings are diagnostic only; keep the UI label stable.
        this.emit('inpaint', 'running', 'Reconstructing zone [AI]...');
        return;
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'error') {
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.type === 'lama-inpaint-result') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        } else if (msg.type === 'lama-disposed') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(undefined);
        }
      }
    };
  }

  private lamaCall<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this.lamaWorker) throw new Error('LaMa worker not created');
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject, expectedType: type });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.lamaWorker!.postMessage({ id, type, payload }, transferables);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LaMa Worker timeout after ${LAMA_TIMEOUT_MS}ms: ${type}`));
        }
      }, LAMA_TIMEOUT_MS);
      this.pendingTimers.add(timer);
    });
  }

  /** Dispose LaMa worker (terminating the worker also frees the ONNX session). */
  private disposeLamaWorker(): void {
    if (this.lamaWorker) {
      this.lamaWorker.terminate();
      this.lamaWorker = null;
    }
  }

  private emit(stage: PipelineStage, status: StageStatus, message?: string): void {
    this.onStageChange(stage, status, message);
  }

  /** Update the stage callback (used when reusing pipeline across images) */
  setStageCallback(cb: StageCallback): void {
    this.onStageChange = cb;
  }

  /** Pre-load the ML model so it's ready when the user drops an image */
  async preloadModel(modelId?: ModelId): Promise<void> {
    await this.mlCall('load-model', undefined, modelId ? { modelId } : undefined);
  }

  /**
   * Decontaminate foreground RGB from color bleed at partial-alpha edges.
   * Runs the multi-level foreground estimator on the CV worker and returns
   * a new RGBA buffer where the RGB is the estimated pure foreground and
   * the alpha channel is preserved.
   *
   * Intended to be called at original resolution, AFTER the alpha mask has
   * been upscaled and any inpainting composited. This is the final-stage
   * cleanup that kills halos before export.
   */
  async estimateForeground(
    pixels: Uint8ClampedArray,
    alpha: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8ClampedArray> {
    return this.cvCall<Uint8ClampedArray>('foreground-estimate', {
      pixels, alpha, width, height,
    });
  }

  /**
   * Combine N watermark masks with logical OR.
   * Returns null if all masks are null.
   */
  private static combineMasks(
    masks: Array<Uint8Array | null>,
    size: number,
  ): Uint8Array | null {
    const validMasks = masks.filter((m): m is Uint8Array => m !== null);
    if (validMasks.length === 0) return null;
    if (validMasks.length === 1) return validMasks[0];

    const combined = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      for (const m of validMasks) {
        if (m[i]) {
          combined[i] = 1;
          break;
        }
      }
    }
    return combined;
  }

  async process(imageData: ImageData, modelId?: ModelId, precision: PrecisionMode = 'normal'): Promise<PipelineResult> {
    this.suppressMlProgress = false; // new image = show progress
    const startTime = performance.now();
    const { width, height } = imageData;
    const originalPixels = new Uint8ClampedArray(imageData.data);
    const stageTiming: Partial<Record<PipelineStage, number>> = {};

    // ── Stage 1: Scan image + classify content type (CV, no ML, instant) ──
    let t = performance.now();
    this.emit('detect-background', 'running', 'Analyzing image...');

    // Run bg detection and content classification in parallel
    const [bgInfo, classifyResult] = await Promise.all([
      this.cvCall<BgColorResult>('detect-bg-colors', {
        pixels: new Uint8ClampedArray(imageData.data),
        width,
        height,
      }),
      this.cvCall<ClassifyImageResult>('classify-image', {
        pixels: new Uint8ClampedArray(imageData.data),
        width,
        height,
      }),
    ]);

    const contentType: ImageContentType = classifyResult.type;
    stageTiming['detect-background'] = performance.now() - t;
    this.emit('detect-background', 'done', `${contentType.toLowerCase()} detected`);
    if (import.meta.env.DEV) console.log(`[NukeBG] Content type: ${contentType}`);

    // ── SIGNATURE path: skip ML entirely, use threshold-based extraction ──
    if (contentType === 'SIGNATURE') {
      t = performance.now();
      this.emit('watermark-scan', 'skipped');
      this.emit('inpaint', 'skipped');
      this.emit('ml-segmentation', 'running', 'Extracting signature...');

      const sigAlpha = await this.cvCall<Uint8Array>('signature-threshold', {
        pixels: new Uint8ClampedArray(originalPixels),
        width,
        height,
      });

      stageTiming['ml-segmentation'] = performance.now() - t;
      this.emit('ml-segmentation', 'done', 'Signature extracted');

      return this.composeResult(originalPixels, sigAlpha, width, height, contentType, false, null, startTime, stageTiming);
    }

    // ── Stage 2: Watermark detection (CV, no ML, instant) - skip for ICON ──
    let watermarkRemoved = false;
    let appliedWatermarkMask: Uint8Array | null = null;

    if (contentType !== 'ICON') {
      t = performance.now();
      this.emit('watermark-scan', 'running', 'Checking for watermarks...');

      const [wmGemini, wmDalle, wmSparkle] = await Promise.all([
        this.cvCall<WatermarkResult>('watermark-detect', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
          colorA: bgInfo.colorA,
          colorB: bgInfo.colorB,
        }),
        this.cvCall<WatermarkResult>('watermark-detect-dalle', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
        }),
        this.cvCall<WatermarkResult>('sparkle-detect', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
        }),
      ]);

      const anyWatermark = wmGemini.detected || wmDalle.detected || wmSparkle.detected;
      const combinedMask = PipelineOrchestrator.combineMasks(
        [wmGemini.mask, wmDalle.mask, wmSparkle.mask],
        width * height,
      );

      if (anyWatermark && combinedMask) {
        const sources: string[] = [];
        if (wmGemini.detected) sources.push('Gemini');
        if (wmDalle.detected) sources.push('DALL-E');
        if (wmSparkle.detected) sources.push('Gemini-shape');
        this.emit('watermark-scan', 'done', `Watermark detected [${sources.join(', ')}]`);
        stageTiming['watermark-scan'] = performance.now() - t;

        // ── Stage 3: Inpaint watermark ──
        // Route: structured content (faces, text, objects) → LaMa (ONNX,
        // content-aware). Uniform content (sky, wall, solid bg) → PatchMatch
        // (CV, instant). See shouldUseLama() for the heuristic.
        t = performance.now();
        const routerDecision = shouldUseLama(originalPixels, width, height, combinedMask);
        if (import.meta.env.DEV) {
          console.log(
            `[NukeBG] Inpaint router: useLama=${routerDecision.useLama} ` +
            `(variance=${routerDecision.variance.toFixed(1)}, ` +
            `edgeDensity=${routerDecision.edgeDensity.toFixed(1)})`,
          );
        }

        const dilated = dilateMask(combinedMask, width, height, INPAINT_PARAMS.FEATHER_RADIUS);
        let inpaintedPixels: Uint8ClampedArray;

        if (routerDecision.useLama) {
          this.emit('inpaint', 'running', 'Reconstructing zone [AI]...');
          this.createLamaWorker();
          try {
            inpaintedPixels = await this.lamaCall<Uint8ClampedArray>('lama-inpaint', {
              pixels: new Uint8ClampedArray(originalPixels),
              width,
              height,
              mask: new Uint8Array(dilated),
            });
          } finally {
            // Free ONNX session memory before RMBG loads next.
            this.disposeLamaWorker();
          }
        } else {
          this.emit('inpaint', 'running', 'Reconstructing watermark area...');
          this.createInpaintWorker();
          try {
            inpaintedPixels = await this.inpaintCall<Uint8ClampedArray>('inpaint', {
              pixels: new Uint8ClampedArray(originalPixels),
              width,
              height,
              mask: new Uint8Array(dilated),
            });
          } finally {
            this.disposeInpaintWorker();
          }
        }

        // Feathered composite: core mask fully replaced with inpainted
        // texture (+ grain noise), feather ring softens the transition to
        // the original photo, rest of the image untouched.
        const blended = compositeWithFeather(
          originalPixels,
          inpaintedPixels,
          combinedMask,
          width,
          height,
          {
            featherRadius: INPAINT_PARAMS.FEATHER_RADIUS,
            noiseSigma: INPAINT_PARAMS.NOISE_SIGMA,
          },
        );
        originalPixels.set(blended);

        watermarkRemoved = true;
        appliedWatermarkMask = combinedMask;
        stageTiming['inpaint'] = performance.now() - t;
        this.emit('inpaint', 'done', routerDecision.useLama ? 'Zone reconstructed [AI]' : 'Watermark reconstructed');
      } else {
        this.emit('watermark-scan', 'done', 'No watermarks found');
        stageTiming['watermark-scan'] = performance.now() - t;
        this.emit('inpaint', 'skipped');
      }
    } else {
      // ICON: skip watermark scan
      this.emit('watermark-scan', 'skipped');
      this.emit('inpaint', 'skipped');
    }

    // ── Stage 4: Background removal (RMBG) ──
    t = performance.now();
    this.emit('ml-segmentation', 'running', 'Loading background removal model...');

    // Use the (possibly inpainted) pixels for segmentation
    const profile = PRECISION_PROFILES[precision];
    const extra: Record<string, unknown> = {};
    if (modelId) extra.modelId = modelId;
    // ICON: use lower threshold for more aggressive removal
    extra.threshold = contentType === 'ICON'
      ? IMAGE_CLASSIFY_PARAMS.ICON_RMBG_THRESHOLD
      : profile.rmbgThreshold;
    extra.refine = {
      spatialPasses: profile.spatialPasses,
      spatialRadius: profile.spatialRadius,
      morphOpenRadius: profile.morphOpenRadius,
      clusterRatio: profile.clusterRatio,
      minClusterSize: profile.minClusterSize,
    };

    const mlAlpha = await this.mlCall<Uint8Array>('segment', {
      pixels: new Uint8ClampedArray(originalPixels),
      width,
      height,
    }, extra);

    stageTiming['ml-segmentation'] = performance.now() - t;
    this.emit('ml-segmentation', 'done', 'Background removed');

    return this.composeResult(
      originalPixels, mlAlpha, width, height, contentType,
      watermarkRemoved, appliedWatermarkMask, startTime, stageTiming,
    );
  }

  /** Compose final RGBA result and compute stats */
  private composeResult(
    originalPixels: Uint8ClampedArray,
    finalAlpha: Uint8Array,
    width: number,
    height: number,
    contentType: ImageContentType,
    watermarkRemoved: boolean,
    watermarkMask: Uint8Array | null,
    startTime: number,
    stageTiming: Partial<Record<PipelineStage, number>>,
  ): PipelineResult {
    // ── Compose final RGBA ──
    const resultPixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      resultPixels[i * 4] = originalPixels[i * 4];
      resultPixels[i * 4 + 1] = originalPixels[i * 4 + 1];
      resultPixels[i * 4 + 2] = originalPixels[i * 4 + 2];
      resultPixels[i * 4 + 3] = finalAlpha[i];
    }

    // Stats: verify background was actually removed
    let opaquePixels = 0;
    let transparentPixels = 0;
    for (let i = 0; i < finalAlpha.length; i++) {
      if (finalAlpha[i] > 200) opaquePixels++;
      else if (finalAlpha[i] < 30) transparentPixels++;
    }
    const totalPixels = width * height;
    const nukedPct = Math.round(100 * transparentPixels / totalPixels);
    if (import.meta.env.DEV) {
      console.log(`[NukeBG] Result: ${nukedPct}% nuked, ${Math.round(100 * opaquePixels / totalPixels)}% kept, ${totalPixels - opaquePixels - transparentPixels} edge pixels`);
    }

    const resultImageData = new ImageData(resultPixels, width, height);
    const totalTimeMs = performance.now() - startTime;

    return {
      imageData: resultImageData,
      workingPixels: originalPixels,
      workingAlpha: finalAlpha,
      workingWidth: width,
      workingHeight: height,
      watermarkMask,
      totalTimeMs,
      watermarkRemoved,
      nukedPct,
      stageTiming,
      contentType,
    };
  }

  destroy(): void {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.cvWorker.terminate();
    this.mlWorker.terminate();
    this.disposeInpaintWorker();
    this.disposeLamaWorker();
  }
}
