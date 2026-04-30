import type {
  PipelineStage,
  StageStatus,
  PipelineResult,
  BgColorResult,
  WatermarkResult,
  ImageContentType,
} from '../types/pipeline';
import type {
  CvWorkerResponse,
  MlWorkerResponse,
  InpaintWorkerResponse,
  LamaWorkerResponse,
  ModelId,
  ClassifyImageResult,
} from '../types/worker-messages';
import { IMAGE_CLASSIFY_PARAMS, INPAINT_PARAMS, PRECISION_PROFILES } from './constants';
import type { PrecisionMode } from './constants';
import { compositeWithFeather, dilateMask } from '../workers/cv/inpaint-blend';
import { shouldUseLama } from '../workers/cv/lama-router';
import { WorkerChannel } from './worker-channel';
import type { ImageProcessor, StageCallback } from './image-processor';

// Re-export so existing callers that imported from the orchestrator
// don't have to chase a new path.
export type { ImageProcessor, StageCallback } from './image-processor';

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
/** Total wall-clock cap for process(). Generous because a first-time
 *  run on a slow connection can pay for the RMBG download (~45MB),
 *  the LaMa download (~95MB) and the ONNX Runtime WASM fetch from
 *  jsDelivr (~6MB) in sequence before any CPU work starts. If this
 *  fires, we've almost certainly hit a pathological hang the per-stage
 *  timeouts didn't catch — abort instead of letting the UI sit forever. */
const PROCESS_TIMEOUT_MS = 20 * 60_000;

/**
 * Error thrown when a pipeline run is aborted via AbortSignal or
 * orchestrator.abort(). Callers can `instanceof PipelineAbortError` to
 * distinguish abort from genuine failures.
 */
export class PipelineAbortError extends Error {
  readonly name = 'PipelineAbortError';
}

export class PipelineOrchestrator implements ImageProcessor {
  private cv: WorkerChannel<CvWorkerResponse>;
  private ml: WorkerChannel<MlWorkerResponse>;
  private inpaint: WorkerChannel<InpaintWorkerResponse>;
  private lama: WorkerChannel<LamaWorkerResponse>;
  private onStageChange: StageCallback;
  private activeSignalCleanup: (() => void) | null = null;
  /** Whether to suppress ML progress updates (during background preload) */
  private suppressMlProgress = false;

  constructor(onStageChange: StageCallback) {
    this.onStageChange = onStageChange;
    this.cv = new WorkerChannel<CvWorkerResponse>({
      name: 'CV',
      timeoutMs: CV_TIMEOUT_MS,
      factory: () =>
        new Worker(new URL('../workers/cv.worker.ts', import.meta.url), { type: 'module' }),
      isProgress: () => false,
      resolveResponse: (msg) =>
        msg.type === 'error'
          ? { kind: 'reject', error: msg.error }
          : { kind: 'resolve', value: msg.result },
    });
    this.ml = new WorkerChannel<MlWorkerResponse>({
      name: 'ML',
      timeoutMs: ML_TIMEOUT_MS,
      factory: () =>
        new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' }),
      isProgress: (msg) => msg.type === 'model-progress' || msg.type === 'warmup-diagnostic',
      onProgress: (msg) => this.onMlProgress(msg),
      resolveResponse: (msg, expectedType) => {
        if (msg.type === 'error') return { kind: 'reject', error: msg.error };
        if (msg.type === 'segment-result') {
          if (expectedType !== 'segment') return { kind: 'ignore' };
          return { kind: 'resolve', value: msg.result };
        }
        if (msg.type === 'model-ready') {
          // Prevent a model-ready message from prematurely resolving a
          // segment request when the worker auto-loads the model.
          if (expectedType !== 'load-model') return { kind: 'ignore' };
          return { kind: 'resolve', value: msg };
        }
        return { kind: 'ignore' };
      },
    });
    this.inpaint = new WorkerChannel<InpaintWorkerResponse>({
      name: 'Inpaint',
      timeoutMs: INPAINT_TIMEOUT_MS,
      factory: () =>
        new Worker(new URL('../workers/inpaint.worker.ts', import.meta.url), { type: 'module' }),
      isProgress: (msg) => msg.type === 'inpaint-progress',
      onProgress: () => this.emit('inpaint', 'running', 'Reconstructing watermark area...'),
      resolveResponse: (msg) => {
        if (msg.type === 'error') return { kind: 'reject', error: msg.error };
        if (msg.type === 'inpaint-result') return { kind: 'resolve', value: msg.result };
        if (msg.type === 'disposed') return { kind: 'resolve', value: undefined };
        return { kind: 'ignore' };
      },
    });
    this.lama = new WorkerChannel<LamaWorkerResponse>({
      name: 'LaMa',
      timeoutMs: LAMA_TIMEOUT_MS,
      factory: () =>
        new Worker(new URL('../workers/lama.worker.ts', import.meta.url), { type: 'module' }),
      isProgress: (msg) =>
        msg.type === 'lama-model-progress' ||
        msg.type === 'lama-model-ready' ||
        msg.type === 'lama-inpaint-progress',
      onProgress: (msg) => this.onLamaProgress(msg),
      resolveResponse: (msg) => {
        if (msg.type === 'error') return { kind: 'reject', error: msg.error };
        if (msg.type === 'lama-inpaint-result') return { kind: 'resolve', value: msg.result };
        if (msg.type === 'lama-disposed') return { kind: 'resolve', value: undefined };
        return { kind: 'ignore' };
      },
    });

    // CV + ML are eager (always needed for any image). Inpaint + LaMa
    // stay lazy so we don't pay for a worker the router may not pick.
    this.cv.start();
    this.ml.start();
  }

  private onMlProgress(msg: MlWorkerResponse): void {
    if (msg.type === 'model-progress') {
      if (this.suppressMlProgress) return; // background preload, don't update UI
      const pct = msg.progress ?? 0;
      const label =
        pct >= 96 && pct < 100
          ? 'Warming up the reactor... [96%]'
          : `Loading AI model... ${pct}% [${pct}%]`;
      this.emit('ml-segmentation', 'running', label);
      return;
    }
    if (msg.type === 'warmup-diagnostic') {
      // surface iOS Safari hang info to console for remote debugging
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
    }
  }

  private onLamaProgress(msg: LamaWorkerResponse): void {
    if (msg.type === 'lama-model-progress') {
      const pct = msg.progress;
      this.emit('inpaint', 'running', `Loading AI inpainting model... ${pct}% [${pct}%]`);
      return;
    }
    // model-ready and inpaint-progress: keep UI label stable.
    this.emit('inpaint', 'running', 'Reconstructing zone [AI]...');
  }

  /**
   * Hard-abort the current pipeline run. Terminates all workers (killing
   * in-flight CPU immediately) and recreates the cv + ml workers so the
   * next `process()` call works. Inpaint/LaMa workers are lazy and are
   * simply dropped. Pending promises reject with `PipelineAbortError`.
   *
   * Called from `process()` when the provided AbortSignal fires, or
   * directly by callers who want to tear down.
   *
   * NOTE: ml worker termination drops the loaded RMBG session — the
   * next segment call re-loads it from the Service Worker cache (fast,
   * not a fresh network download). This is the correct trade-off: a
   * user who aborts expects CPU to stop NOW, not finish the current
   * 45s spatial pass.
   */
  abort(reason = 'aborted'): void {
    const err = new PipelineAbortError(reason);
    this.cv.rejectAllPending(err);
    this.ml.rejectAllPending(err);
    this.inpaint.rejectAllPending(err);
    this.lama.rejectAllPending(err);

    this.cv.recreate();
    this.ml.recreate();
    this.inpaint.dispose();
    this.lama.dispose();
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
    await this.ml.call('load-model', undefined, modelId ? { modelId } : undefined);
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
    return this.cv.call<Uint8ClampedArray>('foreground-estimate', {
      pixels,
      alpha,
      width,
      height,
    });
  }

  /**
   * Combine N watermark masks with logical OR.
   * Returns null if all masks are null.
   */
  private static combineMasks(masks: Array<Uint8Array | null>, size: number): Uint8Array | null {
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

  /**
   * Bind an AbortSignal to the current processing run. Detaches any
   * previously attached signal. When the signal fires, `abort()` runs,
   * pending worker calls reject with `PipelineAbortError`, and workers
   * are torn down. Called internally by `process()`.
   */
  private bindAbortSignal(signal: AbortSignal | undefined): void {
    // Detach previous run's handler, if any.
    this.activeSignalCleanup?.();
    this.activeSignalCleanup = null;
    if (!signal) return;
    if (signal.aborted) {
      this.abort(signal.reason ? String(signal.reason) : 'aborted');
      return;
    }
    const onAbort = () => {
      this.abort(signal.reason ? String(signal.reason) : 'aborted');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    this.activeSignalCleanup = () => signal.removeEventListener('abort', onAbort);
  }

  async process(
    imageData: ImageData,
    modelId?: ModelId,
    precision: PrecisionMode = 'normal',
    signal?: AbortSignal,
  ): Promise<PipelineResult> {
    this.bindAbortSignal(signal);
    // Wall-clock safety net. Rarely meaningful in practice — the
    // per-stage timeouts should kick first — but guarantees the UI
    // never sits on a spinner indefinitely if something truly hangs.
    const timeoutId = setTimeout(() => {
      this.abort(`processing timeout after ${PROCESS_TIMEOUT_MS / 60_000}min`);
    }, PROCESS_TIMEOUT_MS);
    try {
      return await this._process(imageData, modelId, precision);
    } finally {
      clearTimeout(timeoutId);
      // Detach signal listener so a late abort on a previous run can't
      // tear down a subsequent process() that reuses the same signal.
      this.activeSignalCleanup?.();
      this.activeSignalCleanup = null;
    }
  }

  private async _process(
    imageData: ImageData,
    modelId: ModelId | undefined,
    precision: PrecisionMode,
  ): Promise<PipelineResult> {
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
      this.cv.call<BgColorResult>('detect-bg-colors', {
        pixels: new Uint8ClampedArray(imageData.data),
        width,
        height,
      }),
      this.cv.call<ClassifyImageResult>('classify-image', {
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

      const sigAlpha = await this.cv.call<Uint8Array>('signature-threshold', {
        pixels: new Uint8ClampedArray(originalPixels),
        width,
        height,
      });

      stageTiming['ml-segmentation'] = performance.now() - t;
      this.emit('ml-segmentation', 'done', 'Signature extracted');

      return this.composeResult(
        originalPixels,
        sigAlpha,
        width,
        height,
        contentType,
        false,
        null,
        startTime,
        stageTiming,
      );
    }

    // ── Stage 2: Watermark detection (CV, no ML, instant) - skip for ICON ──
    let watermarkRemoved = false;
    let appliedWatermarkMask: Uint8Array | null = null;

    if (contentType !== 'ICON') {
      t = performance.now();
      this.emit('watermark-scan', 'running', 'Checking for watermarks...');

      const [wmGemini, wmDalle, wmSparkle] = await Promise.all([
        this.cv.call<WatermarkResult>('watermark-detect', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
          colorA: bgInfo.colorA,
          colorB: bgInfo.colorB,
        }),
        this.cv.call<WatermarkResult>('watermark-detect-dalle', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
        }),
        this.cv.call<WatermarkResult>('sparkle-detect', {
          pixels: new Uint8ClampedArray(imageData.data),
          width,
          height,
        }),
      ]);

      // The legacy color-deviation `watermarkDetect` produces a high-quality
      // cluster-centroid mask but has NO shape gate, so it false-positives on
      // real photos with bright clustered features in the bottom-right
      // (motorbike chrome, skin highlights, etc. — see issue triage that
      // motivated the original PR #223 retirement). The shape-based
      // `sparkleDetect` adds 6 strict gates (4-arm symmetry, narrow-arm
      // isolation, center peak vs outer ring, etc.) that reliably reject
      // those false-positives but its own mask is just a simple circle at
      // the score-landscape best-fit point.
      //
      // Combine their strengths: only trust the legacy mask when the shape
      // detector ALSO confirms a real Gemini ✦. Together they kill the false
      // positives without sacrificing the cluster-centroid mask quality that
      // produced the clean 984b578b deploy on user's selfie.
      const geminiConfirmed = wmGemini.detected && wmSparkle.detected;
      const geminiMaskGated = geminiConfirmed ? wmGemini.mask : null;
      const anyWatermark = geminiConfirmed || wmDalle.detected || wmSparkle.detected;
      const combinedMask = PipelineOrchestrator.combineMasks(
        [geminiMaskGated, wmDalle.mask, wmSparkle.mask],
        width * height,
      );

      if (anyWatermark && combinedMask) {
        const sources: string[] = [];
        if (geminiConfirmed) sources.push('Gemini');
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
          try {
            inpaintedPixels = await this.lama.call<Uint8ClampedArray>('lama-inpaint', {
              pixels: new Uint8ClampedArray(originalPixels),
              width,
              height,
              mask: new Uint8Array(dilated),
            });
          } finally {
            // Free ONNX session memory before RMBG loads next.
            this.lama.dispose();
          }
        } else {
          this.emit('inpaint', 'running', 'Reconstructing watermark area...');
          try {
            inpaintedPixels = await this.inpaint.call<Uint8ClampedArray>('inpaint', {
              pixels: new Uint8ClampedArray(originalPixels),
              width,
              height,
              mask: new Uint8Array(dilated),
            });
          } finally {
            this.inpaint.dispose();
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
        this.emit(
          'inpaint',
          'done',
          routerDecision.useLama ? 'Zone reconstructed [AI]' : 'Watermark reconstructed',
        );
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
    extra.threshold =
      contentType === 'ICON' ? IMAGE_CLASSIFY_PARAMS.ICON_RMBG_THRESHOLD : profile.rmbgThreshold;
    extra.refine = {
      spatialPasses: profile.spatialPasses,
      spatialRadius: profile.spatialRadius,
      morphOpenRadius: profile.morphOpenRadius,
      clusterRatio: profile.clusterRatio,
      minClusterSize: profile.minClusterSize,
    };

    const mlAlpha = await this.ml.call<Uint8Array>(
      'segment',
      {
        pixels: new Uint8ClampedArray(originalPixels),
        width,
        height,
      },
      extra,
    );

    stageTiming['ml-segmentation'] = performance.now() - t;
    this.emit('ml-segmentation', 'done', 'Background removed');

    return this.composeResult(
      originalPixels,
      mlAlpha,
      width,
      height,
      contentType,
      watermarkRemoved,
      appliedWatermarkMask,
      startTime,
      stageTiming,
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
    const nukedPct = Math.round((100 * transparentPixels) / totalPixels);
    if (import.meta.env.DEV) {
      console.log(
        `[NukeBG] Result: ${nukedPct}% nuked, ${Math.round((100 * opaquePixels) / totalPixels)}% kept, ${totalPixels - opaquePixels - transparentPixels} edge pixels`,
      );
    }

    const resultImageData = new ImageData(resultPixels, width, height);
    const totalTimeMs = performance.now() - startTime;

    // Freeze to prevent accidental reassignment by callers. Typed-array
    // contents remain writable (the runtime does not freeze ArrayBuffer
    // views), but the `readonly` marks on PipelineResult catch those at
    // compile time. If a caller truly needs to mutate, it clones first.
    return Object.freeze({
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
    });
  }

  destroy(): void {
    this.activeSignalCleanup?.();
    this.activeSignalCleanup = null;
    const err = new Error('orchestrator destroyed');
    this.cv.rejectAllPending(err);
    this.ml.rejectAllPending(err);
    this.inpaint.rejectAllPending(err);
    this.lama.rejectAllPending(err);
    this.cv.dispose();
    this.ml.dispose();
    this.inpaint.dispose();
    this.lama.dispose();
  }

  /** Test-only accessors so unit tests can assert the #44 leak is fixed
   *  without touching private state. Sums across all four channels. */
  get _pendingTimersSize(): number {
    return (
      this.cv.pendingTimersSize +
      this.ml.pendingTimersSize +
      this.inpaint.pendingTimersSize +
      this.lama.pendingTimersSize
    );
  }
  get _pendingRequestsSize(): number {
    return (
      this.cv.pendingRequestsSize +
      this.ml.pendingRequestsSize +
      this.inpaint.pendingRequestsSize +
      this.lama.pendingRequestsSize
    );
  }
}
