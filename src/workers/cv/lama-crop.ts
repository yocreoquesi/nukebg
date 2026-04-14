import { LAMA_PARAMS } from '../../pipeline/constants';

export interface LamaCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the square crop rectangle (in ORIGINAL image coordinates)
 * that LaMa will run over. Centred on the mask bbox, expanded by
 * CROP_PADDING for Fourier-conv context, forced to square for the 1:1
 * model input, clamped to the image bounds. Never returns a crop
 * larger than min(width, height) — at worst it's the whole image.
 */
export function computeLamaCropRect(
  mask: Uint8Array,
  width: number,
  height: number,
): LamaCropRect | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const padding = LAMA_PARAMS.CROP_PADDING;
  const px0 = Math.max(0, minX - padding);
  const py0 = Math.max(0, minY - padding);
  const px1 = Math.min(width - 1, maxX + padding);
  const py1 = Math.min(height - 1, maxY + padding);
  const paddedW = px1 - px0 + 1;
  const paddedH = py1 - py0 + 1;

  // Force square, never bigger than the image.
  const maxSide = Math.min(width, height);
  let side = Math.max(paddedW, paddedH, LAMA_PARAMS.MIN_CROP_SIDE);
  side = Math.min(side, maxSide);

  // Centre on the mask bbox midpoint, then clamp so the square fits.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let sx = Math.round(cx - side / 2);
  let sy = Math.round(cy - side / 2);
  sx = Math.max(0, Math.min(sx, width - side));
  sy = Math.max(0, Math.min(sy, height - side));

  return { x: sx, y: sy, w: side, h: side };
}

/**
 * Bilinear resize of an RGBA subregion to a square target. Alpha is
 * carried through unchanged (LaMa ignores it; we preserve it for the
 * splice path which operates on RGBA arrays end-to-end).
 */
export function bilinearResizeRGBA(
  src: Uint8ClampedArray,
  srcWidth: number,
  rect: LamaCropRect,
  targetSize: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(targetSize * targetSize * 4);
  const scaleX = rect.w / targetSize;
  const scaleY = rect.h / targetSize;

  for (let ty = 0; ty < targetSize; ty++) {
    const srcY = rect.y + (ty + 0.5) * scaleY - 0.5;
    const y0 = Math.max(rect.y, Math.floor(srcY));
    const y1 = Math.min(rect.y + rect.h - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, srcY - y0));

    for (let tx = 0; tx < targetSize; tx++) {
      const srcX = rect.x + (tx + 0.5) * scaleX - 0.5;
      const x0 = Math.max(rect.x, Math.floor(srcX));
      const x1 = Math.min(rect.x + rect.w - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, srcX - x0));

      const i00 = (y0 * srcWidth + x0) * 4;
      const i01 = (y0 * srcWidth + x1) * 4;
      const i10 = (y1 * srcWidth + x0) * 4;
      const i11 = (y1 * srcWidth + x1) * 4;
      const di = (ty * targetSize + tx) * 4;

      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i01 + c] * fx;
        const bot = src[i10 + c] * (1 - fx) + src[i11 + c] * fx;
        dst[di + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return dst;
}

/**
 * Nearest-neighbour resize of a binary mask to a square target. Any
 * non-zero source pixel becomes 1, keeping the mask strictly binary
 * for the model input.
 */
export function nearestResizeMask(
  src: Uint8Array,
  srcWidth: number,
  rect: LamaCropRect,
  targetSize: number,
): Uint8Array {
  const dst = new Uint8Array(targetSize * targetSize);
  const scaleX = rect.w / targetSize;
  const scaleY = rect.h / targetSize;

  for (let ty = 0; ty < targetSize; ty++) {
    const srcY = Math.min(rect.y + rect.h - 1, Math.max(rect.y, Math.round(rect.y + ty * scaleY)));
    for (let tx = 0; tx < targetSize; tx++) {
      const srcX = Math.min(rect.x + rect.w - 1, Math.max(rect.x, Math.round(rect.x + tx * scaleX)));
      dst[ty * targetSize + tx] = src[srcY * srcWidth + srcX] ? 1 : 0;
    }
  }
  return dst;
}

/**
 * Paste a square inpainted crop back into a full-image RGBA copy.
 * Resizes the 512×512 LaMa output to `rect.w × rect.h` (bilinear) and
 * overwrites exactly that rectangle in the destination. Alpha of the
 * destination is preserved — we only splice RGB.
 */
export function spliceLamaOutput(
  base: Uint8ClampedArray,
  baseWidth: number,
  baseHeight: number,
  lamaOutput: Uint8ClampedArray,
  lamaSize: number,
  rect: LamaCropRect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base);
  const scaleX = lamaSize / rect.w;
  const scaleY = lamaSize / rect.h;

  for (let y = 0; y < rect.h; y++) {
    const dy = rect.y + y;
    if (dy < 0 || dy >= baseHeight) continue;
    const srcY = Math.max(0, Math.min(lamaSize - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(srcY);
    const y1 = Math.min(lamaSize - 1, y0 + 1);
    const fy = srcY - y0;

    for (let x = 0; x < rect.w; x++) {
      const dx = rect.x + x;
      if (dx < 0 || dx >= baseWidth) continue;
      const srcX = Math.max(0, Math.min(lamaSize - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(srcX);
      const x1 = Math.min(lamaSize - 1, x0 + 1);
      const fx = srcX - x0;

      const i00 = (y0 * lamaSize + x0) * 4;
      const i01 = (y0 * lamaSize + x1) * 4;
      const i10 = (y1 * lamaSize + x0) * 4;
      const i11 = (y1 * lamaSize + x1) * 4;
      const di = (dy * baseWidth + dx) * 4;

      for (let c = 0; c < 3; c++) {
        const top = lamaOutput[i00 + c] * (1 - fx) + lamaOutput[i01 + c] * fx;
        const bot = lamaOutput[i10 + c] * (1 - fx) + lamaOutput[i11 + c] * fx;
        out[di + c] = top * (1 - fy) + bot * fy;
      }
      // out[di + 3] left untouched — preserves the original alpha.
    }
  }
  return out;
}
