import { guidedFilter } from '../cv/alpha-matting.js';
import { EDGE_REFINE_PARAMS } from './constants.js';
import { createImageDataLike } from '../types/image-data-like.js';
import type { ImageDataLike } from '../types/image-data-like.js';

/**
 * Compose the final output at the original input resolution.
 *
 * Moved from packages/nukebg-app/src/utils/final-composite.ts in Phase 8.
 * All `new ImageData(...)` calls replaced with `createImageDataLike(...)`.
 * No DOM globals used.
 */

/**
 * Bilinear upscale of a single-channel Uint8 buffer.
 * Used for alpha and watermark masks.
 */
export function bilinearUpscaleU8(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(src);

  const dst = new Uint8Array(dstW * dstH);
  const xRatio = srcW > 1 ? (srcW - 1) / (dstW - 1 || 1) : 0;
  const yRatio = srcH > 1 ? (srcH - 1) / (dstH - 1 || 1) : 0;

  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = sy - y0;

    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = sx - x0;

      const a = src[y0 * srcW + x0] ?? 0;
      const b = src[y0 * srcW + x1] ?? 0;
      const c = src[y1 * srcW + x0] ?? 0;
      const d = src[y1 * srcW + x1] ?? 0;

      const top = a + (b - a) * dx;
      const bot = c + (d - c) * dx;
      dst[y * dstW + x] = Math.round(top + (bot - top) * dy);
    }
  }

  return dst;
}

/**
 * Bilinear upscale of packed RGBA pixels. Upscales RGB only (keeps a=255);
 * alpha is handled separately by bilinearUpscaleU8.
 */
export function bilinearUpscaleRGB(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(src);

  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = srcW > 1 ? (srcW - 1) / (dstW - 1 || 1) : 0;
  const yRatio = srcH > 1 ? (srcH - 1) / (dstH - 1 || 1) : 0;

  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = sy - y0;

    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = sx - x0;

      const dstIdx = (y * dstW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = src[(y0 * srcW + x0) * 4 + ch] ?? 0;
        const b = src[(y0 * srcW + x1) * 4 + ch] ?? 0;
        const c = src[(y1 * srcW + x0) * 4 + ch] ?? 0;
        const d = src[(y1 * srcW + x1) * 4 + ch] ?? 0;

        const top = a + (b - a) * dx;
        const bot = c + (d - c) * dx;
        dst[dstIdx + ch] = Math.round(top + (bot - top) * dy);
      }
      dst[dstIdx + 3] = 255;
    }
  }

  return dst;
}

/**
 * Snap an upscaled alpha edge to the real image gradient at original
 * resolution.
 */
export function refineUpscaledAlpha(
  alpha: Uint8Array,
  guideRgba: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number = EDGE_REFINE_PARAMS.RADIUS,
  epsilon: number = EDGE_REFINE_PARAMS.EPSILON,
): Uint8Array {
  let hasBand = false;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] ?? 0;
    if (a > EDGE_REFINE_PARAMS.BAND_LO && a < EDGE_REFINE_PARAMS.BAND_HI) {
      hasBand = true;
      break;
    }
  }
  if (!hasBand) return new Uint8Array(alpha);

  const filtered = guidedFilter(alpha, guideRgba, w, h, radius, epsilon);
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] ?? 0;
    out[i] =
      a <= EDGE_REFINE_PARAMS.BAND_LO || a >= EDGE_REFINE_PARAMS.BAND_HI ? a : (filtered[i] ?? 0);
  }
  return out;
}

export interface ComposeAtOriginalInput {
  /** Original full-resolution RGBA pixels (pristine, never downsampled). */
  originalRgba: Uint8ClampedArray;
  originalWidth: number;
  originalHeight: number;

  /** Working (downscaled) RGB pixels after pipeline — possibly inpainted. */
  workingRgba: Uint8ClampedArray;
  workingWidth: number;
  workingHeight: number;

  /** Final alpha mask at working resolution (0..255). */
  workingAlpha: Uint8Array;

  /**
   * Watermark mask at working resolution (0 or 1), if inpainting happened.
   * If omitted or null, original RGB is preserved everywhere.
   */
  inpaintMask?: Uint8Array | null;
}

/**
 * Compose the final RGBA ImageDataLike at original resolution.
 */
export function composeAtOriginal(input: ComposeAtOriginalInput): ImageDataLike {
  const {
    originalRgba,
    originalWidth: oW,
    originalHeight: oH,
    workingRgba,
    workingWidth: wW,
    workingHeight: wH,
    workingAlpha,
    inpaintMask,
  } = input;

  const sameSize = oW === wW && oH === wH;

  // Fast path: no upscale needed.
  if (sameSize) {
    const out = new Uint8ClampedArray(oW * oH * 4);
    for (let i = 0; i < oW * oH; i++) {
      out[i * 4] = workingRgba[i * 4] ?? 0;
      out[i * 4 + 1] = workingRgba[i * 4 + 1] ?? 0;
      out[i * 4 + 2] = workingRgba[i * 4 + 2] ?? 0;
      out[i * 4 + 3] = workingAlpha[i] ?? 0;
    }
    return createImageDataLike(out, oW, oH);
  }

  // Downscale path: bilinear upsample, then snap the soft edge band.
  const upAlphaRaw = bilinearUpscaleU8(workingAlpha, wW, wH, oW, oH);
  const upAlpha = refineUpscaledAlpha(upAlphaRaw, originalRgba, oW, oH);

  const out = new Uint8ClampedArray(originalRgba);

  if (inpaintMask) {
    let maskMax = 0;
    for (let i = 0; i < inpaintMask.length; i++) {
      if ((inpaintMask[i] ?? 0) > maskMax) maskMax = inpaintMask[i] ?? 0;
      if (maskMax === 255) break;
    }
    const scaledMask =
      maskMax === 0 || maskMax === 255
        ? inpaintMask
        : (() => {
            const s = new Uint8Array(inpaintMask.length);
            const k = 255 / maskMax;
            for (let i = 0; i < inpaintMask.length; i++) s[i] = Math.round((inpaintMask[i] ?? 0) * k);
            return s;
          })();

    const upMask = bilinearUpscaleU8(scaledMask, wW, wH, oW, oH);
    const upInpaintRgb = bilinearUpscaleRGB(workingRgba, wW, wH, oW, oH);
    const total = oW * oH;
    for (let i = 0; i < total; i++) {
      const m = upMask[i] ?? 0;
      if (m === 0) continue;
      const w = m / 255;
      const invW = 1 - w;
      const px = i * 4;
      out[px] = (out[px] ?? 0) * invW + (upInpaintRgb[px] ?? 0) * w;
      out[px + 1] = (out[px + 1] ?? 0) * invW + (upInpaintRgb[px + 1] ?? 0) * w;
      out[px + 2] = (out[px + 2] ?? 0) * invW + (upInpaintRgb[px + 2] ?? 0) * w;
    }
  }

  const total = oW * oH;
  for (let i = 0; i < total; i++) {
    out[i * 4 + 3] = upAlpha[i] ?? 0;
  }

  return createImageDataLike(out, oW, oH);
}
