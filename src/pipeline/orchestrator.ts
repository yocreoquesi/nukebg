import type {
  PipelineStage,
  StageStatus,
  PipelineResult,
  BackgroundType,
  BgColorResult,
  WatermarkResult,
} from '../types/pipeline';
import type { CvWorkerResponse, MlWorkerResponse, InpaintWorkerResponse, ModelId } from '../types/worker-messages';
import { CV_PARAMS } from './constants';

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
/** Inpaint timeout: Telea CV es instantaneo, 30s es mas que suficiente */
const INPAINT_TIMEOUT_MS = 30_000;
/** Matting timeout: ViTMatte model download + inference */
const MATTING_TIMEOUT_MS = 120_000;

export class PipelineOrchestrator {
  private cvWorker: Worker;
  private mlWorker: Worker;
  private inpaintWorker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
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

    this.cvWorker.onerror = (e) => this.rejectAllPending(`CV Worker error: ${e.message}`);
    this.mlWorker.onerror = (e) => this.rejectAllPending(`ML Worker error: ${e.message}`);

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

    this.mlWorker.onmessage = (e: MessageEvent<MlWorkerResponse>) => {
      const msg = e.data;
      // model-progress events: forward to UI, don't resolve the pending request
      if (msg.type === 'model-progress') {
        const pct = msg.progress ?? 0;
        const label = pct >= 96 && pct < 100
          ? 'Warming up the reactor... [96%]'
          : `Loading AI model... ${pct}% [${pct}%]`;
        this.emit('ml-segmentation', 'running', label);
        return;
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'error') {
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.type === 'segment-result') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        } else if (msg.type === 'model-ready') {
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
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(message));
    }
    this.pendingRequests.clear();
  }

  private cvCall<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.cvWorker.postMessage({ id, type, payload }, transferables);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`CV Worker timeout after ${CV_TIMEOUT_MS}ms: ${type}`));
        }
      }, CV_TIMEOUT_MS);
    });
  }

  private mlCall<T>(type: string, payload?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = generateUUID();
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.mlWorker.postMessage({ id, type, payload, ...extra }, transferables);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`ML Worker timeout after ${ML_TIMEOUT_MS}ms: ${type}. Check browser console for errors.`));
        }
      }, ML_TIMEOUT_MS);
    });
  }

  /** Crear el inpaint worker lazy (solo si se necesita) */
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
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      const transferables = PipelineOrchestrator.extractTransferables(payload);
      this.inpaintWorker!.postMessage({ id, type, payload }, transferables);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Inpaint Worker timeout after ${INPAINT_TIMEOUT_MS}ms: ${type}`));
        }
      }, INPAINT_TIMEOUT_MS);
    });
  }

  /** Dispose inpaint worker y liberar memoria */
  private disposeInpaintWorker(): void {
    if (this.inpaintWorker) {
      this.inpaintWorker.terminate();
      this.inpaintWorker = null;
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
   * Combinar dos mascaras de watermark con OR logico.
   * Si ambas son null, devuelve null.
   */
  private static combineMasks(
    maskA: Uint8Array | null,
    maskB: Uint8Array | null,
    size: number,
  ): Uint8Array | null {
    if (!maskA && !maskB) return null;
    if (!maskA) return maskB;
    if (!maskB) return maskA;

    const combined = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      combined[i] = maskA[i] || maskB[i] ? 1 : 0;
    }
    return combined;
  }

  async process(imageData: ImageData, modelId?: ModelId, refineEdges: boolean = false): Promise<PipelineResult> {
    const startTime = performance.now();
    const { width, height } = imageData;
    const originalPixels = new Uint8ClampedArray(imageData.data);
    const stageTiming: Partial<Record<PipelineStage, number>> = {};

    // ── Stage 1: Scan image (CV, no ML, instant) ──
    let t = performance.now();
    this.emit('detect-background', 'running', 'Scanning image...');
    const bgInfo = await this.cvCall<BgColorResult>('detect-bg-colors', {
      pixels: new Uint8ClampedArray(imageData.data),
      width,
      height,
    });
    const bgType: BackgroundType = bgInfo.isCheckerboard
      ? 'checkerboard'
      : bgInfo.cornerVariance < CV_PARAMS.SOLID_BG_VARIANCE
        ? 'solid'
        : 'complex';
    stageTiming['detect-background'] = performance.now() - t;
    this.emit('detect-background', 'done', `${bgType} detected`);

    // ── Stage 2: Watermark detection (CV, no ML, instant) ──
    t = performance.now();
    this.emit('watermark-scan', 'running', 'Checking for watermarks...');

    const [wmGemini, wmDalle] = await Promise.all([
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
    ]);

    const anyWatermark = wmGemini.detected || wmDalle.detected;
    const combinedMask = PipelineOrchestrator.combineMasks(
      wmGemini.mask,
      wmDalle.mask,
      width * height,
    );

    let watermarkRemoved = false;

    if (anyWatermark && combinedMask) {
      this.emit('watermark-scan', 'done', 'Watermark detected');
      stageTiming['watermark-scan'] = performance.now() - t;

      // ── Stage 3: Inpaint watermark (Telea FMM, puro CV) ──
      t = performance.now();
      this.emit('inpaint', 'running', 'Reconstructing watermark area...');

      this.createInpaintWorker();
      try {
        const inpaintedPixels = await this.inpaintCall<Uint8ClampedArray>('inpaint', {
          pixels: new Uint8ClampedArray(originalPixels),
          width,
          height,
          mask: new Uint8Array(combinedMask),
        });

        // Replace watermark pixels in our working copy
        for (let i = 0; i < width * height; i++) {
          if (combinedMask[i]) {
            originalPixels[i * 4] = inpaintedPixels[i * 4];
            originalPixels[i * 4 + 1] = inpaintedPixels[i * 4 + 1];
            originalPixels[i * 4 + 2] = inpaintedPixels[i * 4 + 2];
            originalPixels[i * 4 + 3] = inpaintedPixels[i * 4 + 3];
          }
        }

        watermarkRemoved = true;
        stageTiming['inpaint'] = performance.now() - t;
        this.emit('inpaint', 'done', 'Watermark reconstructed');
      } finally {
        // Liberar el worker de inpaint
        this.disposeInpaintWorker();
      }
    } else {
      this.emit('watermark-scan', 'done', 'No watermarks found');
      stageTiming['watermark-scan'] = performance.now() - t;
      this.emit('inpaint', 'skipped');
    }

    // ── Stage 4: Background removal (RMBG, second ML model) ──
    t = performance.now();
    this.emit('ml-segmentation', 'running', 'Loading background removal model...');

    // Use the (possibly inpainted) pixels for segmentation
    const extra: Record<string, unknown> = {};
    if (modelId) extra.modelId = modelId;

    const mlAlpha = await this.mlCall<Uint8Array>('segment', {
      pixels: new Uint8ClampedArray(originalPixels),
      width,
      height,
    }, Object.keys(extra).length > 0 ? extra : undefined);

    stageTiming['ml-segmentation'] = performance.now() - t;
    this.emit('ml-segmentation', 'done', 'Background removed');

    // ── Build pre-refine image (RMBG-only alpha) ──
    const preRefinePixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      preRefinePixels[i * 4] = originalPixels[i * 4];
      preRefinePixels[i * 4 + 1] = originalPixels[i * 4 + 1];
      preRefinePixels[i * 4 + 2] = originalPixels[i * 4 + 2];
      preRefinePixels[i * 4 + 3] = mlAlpha[i];
    }
    const preRefineImageData = new ImageData(preRefinePixels, width, height);

    // ── Stage 5: Edge refine (ViTMatte alpha matting) — conditional ──
    let finalAlpha: Uint8Array;

    if (refineEdges) {
      t = performance.now();
      this.emit('edge-refine', 'running', 'Refining edges...');

      // Dispose ML worker first to free memory for ViTMatte
      this.mlWorker.terminate();

      try {
        finalAlpha = await this.runMattingWorker(originalPixels, mlAlpha, width, height);
      } catch (err) {
        // If matting fails, fall back to RMBG alpha
        console.warn('Edge refine failed, using RMBG alpha:', err);
        finalAlpha = mlAlpha;
      }

      stageTiming['edge-refine'] = performance.now() - t;
      this.emit('edge-refine', 'done', 'Edges refined');

      // Recreate ML worker for next image (model will reload on next use)
      this.recreateMlWorker();
    } else {
      // Skip ViTMatte — use RMBG alpha directly, do NOT terminate ML worker
      finalAlpha = mlAlpha;
      this.emit('edge-refine', 'skipped');
    }

    // ── Compose final RGBA ──
    const resultPixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      resultPixels[i * 4] = originalPixels[i * 4];
      resultPixels[i * 4 + 1] = originalPixels[i * 4 + 1];
      resultPixels[i * 4 + 2] = originalPixels[i * 4 + 2];
      resultPixels[i * 4 + 3] = finalAlpha[i];
    }

    const resultImageData = new ImageData(resultPixels, width, height);
    const totalTimeMs = performance.now() - startTime;

    return {
      imageData: resultImageData,
      totalTimeMs,
      backgroundType: bgType,
      watermarkRemoved,
      stageTiming,
      preRefineImageData: refineEdges ? preRefineImageData : undefined,
    };
  }

  /** Run ViTMatte matting worker: create, run, dispose */
  private runMattingWorker(
    originalPixels: Uint8ClampedArray,
    mask: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const mattingWorker = new Worker(
        new URL('../workers/matting.worker.ts', import.meta.url),
        { type: 'module' }
      );

      const timeoutId = setTimeout(() => {
        mattingWorker.terminate();
        reject(new Error(`Matting Worker timeout after ${MATTING_TIMEOUT_MS}ms`));
      }, MATTING_TIMEOUT_MS);

      mattingWorker.onerror = (e) => {
        clearTimeout(timeoutId);
        mattingWorker.terminate();
        reject(new Error(`Matting Worker error: ${e.message}`));
      };

      mattingWorker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'matting-progress') {
          this.emit('edge-refine', 'running', `Refining edges... [${msg.stage}]`);
        } else if (msg.type === 'matting-result') {
          clearTimeout(timeoutId);
          // Dispose and terminate
          mattingWorker.postMessage({ id: 'dispose-final', type: 'dispose' });
          setTimeout(() => mattingWorker.terminate(), 500);
          resolve(msg.result);
        } else if (msg.type === 'error') {
          clearTimeout(timeoutId);
          mattingWorker.terminate();
          reject(new Error(msg.error));
        }
      };

      mattingWorker.postMessage({
        id: generateUUID(),
        type: 'refine',
        payload: {
          pixels: new Uint8ClampedArray(originalPixels),
          mask: new Uint8Array(mask),
          width,
          height,
        },
      });
    });
  }

  /** Recreate ML worker after ViTMatte terminates it */
  private recreateMlWorker(): void {
    this.mlWorker = new Worker(
      new URL('../workers/ml.worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.mlWorker.onerror = (e) => this.rejectAllPending(`ML Worker error: ${e.message}`);
    this.mlWorker.onmessage = (e: MessageEvent<MlWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'model-progress') {
        const pct = msg.progress ?? 0;
        const label = pct >= 96 && pct < 100
          ? 'Warming up the reactor... [96%]'
          : `Loading AI model... ${pct}% [${pct}%]`;
        this.emit('ml-segmentation', 'running', label);
        return;
      }
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'error') {
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.type === 'segment-result') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.result);
        } else if (msg.type === 'model-ready') {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg);
        }
      }
    };
  }

  /**
   * Run ViTMatte refinement on an already-processed image.
   * Used for post-process "Refine edges" button.
   */
  async refineOnly(imageData: ImageData): Promise<ImageData> {
    const { width, height } = imageData;
    const pixels = imageData.data;

    // Extract the alpha channel as the RMBG mask
    const mlAlpha = new Uint8Array(width * height);
    const originalPixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      originalPixels[i * 4] = pixels[i * 4];
      originalPixels[i * 4 + 1] = pixels[i * 4 + 1];
      originalPixels[i * 4 + 2] = pixels[i * 4 + 2];
      originalPixels[i * 4 + 3] = 255; // full opacity for matting input
      mlAlpha[i] = pixels[i * 4 + 3];
    }

    this.emit('edge-refine', 'running', 'Refining edges...');

    // Terminate ML worker to free memory for ViTMatte
    this.mlWorker.terminate();

    let refinedAlpha: Uint8Array;
    try {
      refinedAlpha = await this.runMattingWorker(originalPixels, mlAlpha, width, height);
    } catch (err) {
      console.warn('Edge refine failed, using original alpha:', err);
      this.recreateMlWorker();
      throw err;
    }

    this.emit('edge-refine', 'done', 'Edges refined');
    this.recreateMlWorker();

    // Compose refined result
    const resultPixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      resultPixels[i * 4] = pixels[i * 4];
      resultPixels[i * 4 + 1] = pixels[i * 4 + 1];
      resultPixels[i * 4 + 2] = pixels[i * 4 + 2];
      resultPixels[i * 4 + 3] = refinedAlpha[i];
    }

    return new ImageData(resultPixels, width, height);
  }

  destroy(): void {
    this.cvWorker.terminate();
    this.mlWorker.terminate();
    this.disposeInpaintWorker();
  }
}
