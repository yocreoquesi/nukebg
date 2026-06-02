/**
 * Runtime-agnostic pipeline orchestrator.
 *
 * Implements the algorithm from design §D.1. Calls pure CV functions directly
 * (no Workers, no DOM, no file system). Runner implementations are injected
 * via `RunnerBundle` — the caller provides the ML adapters appropriate for
 * its runtime (browser Worker, Node ONNX, etc.).
 *
 * No `new ImageData(...)` anywhere in this file — only `createImageDataLike`.
 */

import type { ImageDataLike } from '../types/image-data-like.js';
import { createImageDataLike } from '../types/image-data-like.js';
import type { PipelineOptions } from '../types/pipeline-options.js';
import type { PipelineResult, ImageContentType, PipelineStage } from '../types/pipeline-result.js';
import type { RmbgRunner } from '../runners/rmbg-runner.js';
import type { LamaRunner } from '../runners/lama-runner.js';
import { extractImageFeatures, classifyImage } from '../cv/classify-image.js';
import { detectBgColors } from '../cv/detect-bg-colors.js';
import { watermarkDetect } from '../cv/watermark-detect.js';
import { watermarkDetectDalle } from '../cv/watermark-dalle.js';
import { sparkleDetect } from '../cv/sparkle-detect.js';
import { signatureThreshold } from '../cv/signature-threshold.js';
import { compositeWithFeather, dilateMask } from '../cv/inpaint-blend.js';
import { shouldUseLama } from '../cv/lama-router.js';
import { patchMatchInpaint } from '../inpaint/patch-match.js';
import {
  PRECISION_PROFILES,
  INPAINT_PARAMS,
  IMAGE_CLASSIFY_PARAMS,
} from './constants.js';
import type { PrecisionMode } from './constants.js';
import { PipelineAbortError, RmbgError, LamaError } from './errors.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The two runner implementations injected by the caller.
 * `lama` is optional — when omitted, the LaMa branch falls back to PatchMatch.
 */
export interface RunnerBundle {
  readonly rmbg: RmbgRunner;
  /** Optional — when omitted, LaMa branch falls back to PatchMatch. */
  readonly lama?: LamaRunner;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Map PipelinePrecision values (from the public API) to the internal
 * PrecisionMode values used by PRECISION_PROFILES.
 *
 * The public API uses friendly names (low | normal | high | ultra).
 * The internal table uses legacy names from the Python prototype.
 */
function precisionToPrecisionMode(precision: string): PrecisionMode {
  switch (precision) {
    case 'low':
      return 'low-power';
    case 'high':
      return 'high-power';
    case 'ultra':
      return 'full-nuke';
    default:
      // 'normal' and any unknown value → 'normal'
      return 'normal';
  }
}

/**
 * Map a concrete PipelineMode (photo | signature | icon) to the internal
 * ImageContentType used by the CV functions and result fields.
 *
 * 'auto' is handled upstream by running the classifier — this function
 * is only called for explicit mode selections.
 */
function modeToContentType(
  mode: 'photo' | 'signature' | 'icon',
): ImageContentType {
  switch (mode) {
    case 'signature':
      return 'SIGNATURE';
    case 'icon':
      return 'ICON';
    default:
      return 'PHOTO';
  }
}

/**
 * Map an internal ImageContentType back to the public resolvedMode string.
 */
function contentTypeToResolvedMode(
  ct: ImageContentType,
): 'photo' | 'signature' | 'icon' {
  switch (ct) {
    case 'SIGNATURE':
      return 'signature';
    case 'ICON':
      return 'icon';
    default:
      return 'photo';
  }
}

/**
 * Combine N watermark masks with logical OR.
 * Returns null if all masks are null.
 */
function combineMasks(
  masks: Array<Uint8Array | null>,
  size: number,
): Uint8Array | null {
  const valid = masks.filter((m): m is Uint8Array => m !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    // Safety: valid[0] is always defined here because valid.length === 1
    return valid[0] ?? null;
  }

  const combined = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    for (const m of valid) {
      if (m[i]) {
        combined[i] = 1;
        break;
      }
    }
  }
  return combined;
}

/**
 * Compose the final RGBA image from the working pixel buffer and alpha mask.
 * Returns a plain ImageDataLike — no `new ImageData()`.
 */
function composeResult(
  workingPixels: Uint8ClampedArray,
  finalAlpha: Uint8Array,
  width: number,
  height: number,
  contentType: ImageContentType,
  watermarkRemoved: boolean,
  watermarkMask: Uint8Array | null,
  startTime: number,
  // Raw stage timing accumulated during the run (design key names)
  stageTiming: Partial<Record<PipelineStage, number>>,
  // finalize duration (set to 0 because composition is synchronous/instant here)
  finalizeDurationMs: number,
): PipelineResult {
  // Build the RGBA output
  const totalPixels = width * height;
  const resultPixels = new Uint8ClampedArray(totalPixels * 4);

  for (let i = 0; i < totalPixels; i++) {
    resultPixels[i * 4] = workingPixels[i * 4] ?? 0;
    resultPixels[i * 4 + 1] = workingPixels[i * 4 + 1] ?? 0;
    resultPixels[i * 4 + 2] = workingPixels[i * 4 + 2] ?? 0;
    resultPixels[i * 4 + 3] = finalAlpha[i] ?? 0;
  }

  // Stats
  let transparentPixels = 0;
  for (let i = 0; i < finalAlpha.length; i++) {
    if ((finalAlpha[i] ?? 0) < 30) transparentPixels++;
  }
  const nukedPct = Math.round((100 * transparentPixels) / totalPixels);

  const output = createImageDataLike(resultPixels, width, height);
  const durationMs = performance.now() - startTime;

  // Build stageTimings that satisfies BOTH:
  //   - design §D.1 key names  (detect-background, ml-segmentation, watermark-scan, inpaint)
  //   - REQ-CORE-PIPELINE-6 spec-required keys (watermark, rmbg, inpaint, finalize)
  // We include all of them so any consumer is satisfied.
  const stageTimings: Record<string, number> = {
    // Design-style keys (retained for compatibility with existing PipelineStage type)
    'detect-background': stageTiming['detect-background'] ?? 0,
    'ml-segmentation': stageTiming['ml-segmentation'] ?? 0,
    'watermark-scan': stageTiming['watermark-scan'] ?? 0,
    inpaint: stageTiming['inpaint'] ?? 0,
    // Spec-required keys (REQ-CORE-PIPELINE-6)
    watermark: stageTiming['watermark-scan'] ?? 0,
    rmbg: stageTiming['ml-segmentation'] ?? 0,
    finalize: finalizeDurationMs,
  };

  return Object.freeze({
    output,
    resolvedMode: contentTypeToResolvedMode(contentType),
    durationMs,
    stageTimings,
    watermarkRemoved,
    watermarkMask,
    workingPixels,
    workingAlpha: finalAlpha,
    workingWidth: width,
    workingHeight: height,
    nukedPct,
    contentType,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runtime-agnostic pipeline orchestrator.
 *
 * Implements design §D.1. Accepts any `RunnerBundle` and executes the full
 * pipeline using pure CV functions for classification, watermark detection,
 * inpainting routing, and RMBG segmentation.
 *
 * Rejects with:
 *   - `PipelineAbortError` if `options.signal` fires
 *   - `RmbgError`          if `runners.rmbg.segment` rejects
 *   - `LamaError`          if `runners.lama.inpaint` rejects
 */
export async function runPipeline(
  input: ImageDataLike,
  runners: RunnerBundle,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const {
    mode = 'auto',
    precision = 'normal',
    skipWatermark = false,
    signal,
    onStage,
  } = options;

  // Helper: emit a stage event (no-op when onStage is not provided)
  const emit = (
    stage: PipelineStage,
    status: 'running' | 'done' | 'skipped' | 'error',
    message?: string,
  ): void => {
    onStage?.(message !== undefined ? { stage, status, message } : { stage, status });
  };

  // Check abort at each major boundary
  const checkAbort = (): void => {
    if (signal?.aborted) {
      throw new PipelineAbortError('aborted');
    }
  };

  // Abort check at entry — catch signals fired before the call
  checkAbort();

  const start = performance.now();
  const stageTiming: Partial<Record<PipelineStage, number>> = {};
  const { width, height } = input;
  // Copy pixels so we can modify in-place for inpainting without mutating the input
  const originalPixels = new Uint8ClampedArray(input.data);

  // ── Stage 1: classify + bg detect (CV, parallel) ──
  emit('detect-background', 'running', 'Analyzing image...');
  const t1 = performance.now();

  const [bgInfo, features] = await Promise.all([
    Promise.resolve(detectBgColors(originalPixels, width, height)),
    Promise.resolve(extractImageFeatures(originalPixels, width, height)),
  ]);

  const classifyResult = classifyImage(features);

  checkAbort();

  const contentType: ImageContentType =
    mode === 'auto'
      ? classifyResult
      : modeToContentType(mode as 'photo' | 'signature' | 'icon');

  stageTiming['detect-background'] = performance.now() - t1;
  emit('detect-background', 'done', `${contentType.toLowerCase()} detected`);

  // ── SIGNATURE shortcut: skip ML ──
  if (contentType === 'SIGNATURE') {
    emit('watermark-scan', 'skipped');
    emit('inpaint', 'skipped');
    emit('ml-segmentation', 'running', 'Extracting signature...');

    const t2 = performance.now();
    const sigAlpha = signatureThreshold(originalPixels, width, height);
    stageTiming['ml-segmentation'] = performance.now() - t2;
    emit('ml-segmentation', 'done', 'Signature extracted');

    const tFinalize = performance.now();
    const result = composeResult(
      originalPixels,
      sigAlpha,
      width,
      height,
      contentType,
      false,
      null,
      start,
      stageTiming,
      performance.now() - tFinalize,
    );
    return result;
  }

  // ── Stage 2 + 3: watermark detect + inpaint (skip for ICON or skipWatermark) ──
  let watermarkRemoved = false;
  let appliedWatermarkMask: Uint8Array | null = null;

  if (contentType !== 'ICON' && !skipWatermark) {
    emit('watermark-scan', 'running', 'Checking for watermarks...');
    const t2 = performance.now();

    const [wmGemini, wmDalle, wmSparkle] = await Promise.all([
      Promise.resolve(
        watermarkDetect(originalPixels, width, height, bgInfo.colorA, bgInfo.colorB),
      ),
      Promise.resolve(watermarkDetectDalle(originalPixels, width, height)),
      Promise.resolve(sparkleDetect(originalPixels, width, height)),
    ]);

    checkAbort();

    const geminiConfirmed = wmGemini.detected && wmSparkle.detected;
    const geminiMaskGated = geminiConfirmed ? wmGemini.mask : null;
    const anyWatermark = geminiConfirmed || wmDalle.detected || wmSparkle.detected;
    const combinedMask = combineMasks(
      [geminiMaskGated, wmDalle.mask, wmSparkle.mask],
      width * height,
    );

    if (anyWatermark && combinedMask) {
      stageTiming['watermark-scan'] = performance.now() - t2;
      emit('watermark-scan', 'done', 'Watermark detected');

      const t3 = performance.now();
      const router = shouldUseLama(originalPixels, width, height, combinedMask);
      const dilated = dilateMask(combinedMask, width, height, INPAINT_PARAMS.FEATHER_RADIUS);
      let inpainted: Uint8ClampedArray;

      if (router.useLama && runners.lama) {
        emit('inpaint', 'running', 'Reconstructing zone [AI]...');
        try {
          inpainted = await runners.lama.inpaint(
            createImageDataLike(originalPixels, width, height),
            dilated,
            signal !== undefined ? { signal } : {},
          );
        } catch (err: unknown) {
          if (err instanceof PipelineAbortError) throw err;
          throw new LamaError('LaMa inpaint failed', { cause: err });
        } finally {
          await runners.lama.dispose();
        }
      } else {
        emit('inpaint', 'running', 'Reconstructing watermark area...');
        inpainted = patchMatchInpaint(originalPixels, width, height, dilated);
      }

      checkAbort();

      const blended = compositeWithFeather(
        originalPixels,
        inpainted,
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
      stageTiming['inpaint'] = performance.now() - t3;
      emit(
        'inpaint',
        'done',
        router.useLama && runners.lama
          ? 'Zone reconstructed [AI]'
          : 'Watermark reconstructed',
      );
    } else {
      emit('watermark-scan', 'done', 'No watermarks found');
      emit('inpaint', 'skipped');
      stageTiming['watermark-scan'] = performance.now() - t2;
    }
  } else {
    emit('watermark-scan', 'skipped');
    emit('inpaint', 'skipped');
  }

  // ── Stage 4: RMBG segmentation ──
  emit('ml-segmentation', 'running', 'Loading background removal model...');
  const t4 = performance.now();
  const precisionMode = precisionToPrecisionMode(precision);
  const profile = PRECISION_PROFILES[precisionMode];
  const threshold =
    contentType === 'ICON'
      ? IMAGE_CLASSIFY_PARAMS.ICON_RMBG_THRESHOLD
      : profile.rmbgThreshold;

  let mlAlpha: Uint8Array;
  try {
    mlAlpha = await runners.rmbg.segment(
      createImageDataLike(originalPixels, width, height),
      {
        threshold,
        refine: {
          spatialPasses: profile.spatialPasses,
          spatialRadius: profile.spatialRadius,
          morphOpenRadius: profile.morphOpenRadius,
          clusterRatio: profile.clusterRatio,
          minClusterSize: profile.minClusterSize,
        },
        ...(signal !== undefined ? { signal } : {}),
        onProgress: (pct) =>
          emit('ml-segmentation', 'running', `Loading AI model... ${pct}%`),
      },
    );
  } catch (err: unknown) {
    if (err instanceof PipelineAbortError) throw err;
    throw new RmbgError('RMBG segmentation failed', { cause: err });
  }

  stageTiming['ml-segmentation'] = performance.now() - t4;
  emit('ml-segmentation', 'done', 'Background removed');

  // ── Finalize ──
  const tFinalize = performance.now();
  const result = composeResult(
    originalPixels,
    mlAlpha,
    width,
    height,
    contentType,
    watermarkRemoved,
    appliedWatermarkMask,
    start,
    stageTiming,
    performance.now() - tFinalize,
  );

  return result;
}
