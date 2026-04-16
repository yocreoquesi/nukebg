import { guidedFilter } from '../workers/cv/alpha-matting';
import { GUIDED_FILTER_PARAMS } from '../pipeline/constants';

/**
 * Compose the final output at the original input resolution.
 *
 * When the pipeline runs on a downscaled working copy (memory budget),
 * this helper upscales the resulting alpha mask back to the original
 * resolution and composites it onto the original RGB pixels. Pristine
 * RGB is preserved outside the watermark region; inside the watermark
 * region we upscale the inpainted RGB and blend using the mask.
 *
 * When refineAlpha is true, applies a guided filter at original resolution
 * to snap mask edges to the real image features — eliminates the mushy
 * edges from bilinear upscale of the 1024px RMBG mask.
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

      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];

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
        const a = src[(y0 * srcW + x0) * 4 + ch];
        const b = src[(y0 * srcW + x1) * 4 + ch];
        const c = src[(y1 * srcW + x0) * 4 + ch];
        const d = src[(y1 * srcW + x1) * 4 + ch];

        const top = a + (b - a) * dx;
        const bot = c + (d - c) * dx;
        dst[dstIdx + ch] = Math.round(top + (bot - top) * dy);
      }
      dst[dstIdx + 3] = 255;
    }
  }

  return dst;
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
   * Controls which pixels get replaced by upscaled inpainted RGB.
   * If omitted or null, original RGB is preserved everywhere.
   */
  inpaintMask?: Uint8Array | null;

  /**
   * When true, applies a guided filter at original resolution after
   * bilinear upscale to snap alpha edges to real image features.
   */
  refineAlpha?: boolean;
}

/**
 * Compose the final RGBA ImageData at original resolution.
 * - Alpha: bilinear-upscaled from working size.
 * - RGB: original pristine pixels, with inpainted region replaced where mask says so.
 */
export function composeAtOriginal(input: ComposeAtOriginalInput): ImageData {
  const {
    originalRgba, originalWidth: oW, originalHeight: oH,
    workingRgba, workingWidth: wW, workingHeight: wH,
    workingAlpha, inpaintMask, refineAlpha,
  } = input;

  const sameSize = oW === wW && oH === wH;

  // Fast path: no upscale needed
  if (sameSize) {
    const alpha = refineAlpha
      ? guidedFilter(workingAlpha, originalRgba, oW, oH, GUIDED_FILTER_PARAMS.RADIUS, GUIDED_FILTER_PARAMS.EPSILON)
      : workingAlpha;
    const out = new Uint8ClampedArray(oW * oH * 4);
    for (let i = 0; i < oW * oH; i++) {
      out[i * 4] = workingRgba[i * 4];
      out[i * 4 + 1] = workingRgba[i * 4 + 1];
      out[i * 4 + 2] = workingRgba[i * 4 + 2];
      out[i * 4 + 3] = alpha[i];
    }
    return new ImageData(out, oW, oH);
  }

  // Upscale alpha (bilinear — preserves soft edges)
  let upAlpha = bilinearUpscaleU8(workingAlpha, wW, wH, oW, oH);

  // Guided filter snaps the upscaled mask edges to real image features,
  // eliminating the mushy edges from bilinear upscale of the 1024px RMBG mask.
  if (refineAlpha) {
    upAlpha = guidedFilter(upAlpha, originalRgba, oW, oH, GUIDED_FILTER_PARAMS.RADIUS, GUIDED_FILTER_PARAMS.EPSILON);
  }

  // Base RGB: pristine original
  const out = new Uint8ClampedArray(originalRgba);

  // If inpaint happened, blend upscaled inpainted RGB in masked region.
  // The detector emits a binary 0/1 mask — normalize to 0/255 before bilinear
  // upscale so interpolated boundary weights live in the full 0..255 range.
  if (inpaintMask) {
    let maskMax = 0;
    for (let i = 0; i < inpaintMask.length; i++) {
      if (inpaintMask[i] > maskMax) maskMax = inpaintMask[i];
      if (maskMax === 255) break;
    }
    const scaledMask =
      maskMax === 0 || maskMax === 255
        ? inpaintMask
        : (() => {
            const s = new Uint8Array(inpaintMask.length);
            const k = 255 / maskMax;
            for (let i = 0; i < inpaintMask.length; i++) s[i] = Math.round(inpaintMask[i] * k);
            return s;
          })();

    const upMask = bilinearUpscaleU8(scaledMask, wW, wH, oW, oH);
    const upInpaintRgb = bilinearUpscaleRGB(workingRgba, wW, wH, oW, oH);
    const total = oW * oH;
    for (let i = 0; i < total; i++) {
      const m = upMask[i];
      if (m === 0) continue;
      const w = m / 255;
      const invW = 1 - w;
      const px = i * 4;
      out[px] = out[px] * invW + upInpaintRgb[px] * w;
      out[px + 1] = out[px + 1] * invW + upInpaintRgb[px + 1] * w;
      out[px + 2] = out[px + 2] * invW + upInpaintRgb[px + 2] * w;
    }
  }

  // Write upscaled alpha into RGBA
  const total = oW * oH;
  for (let i = 0; i < total; i++) {
    out[i * 4 + 3] = upAlpha[i];
  }

  return new ImageData(out, oW, oH);
}
