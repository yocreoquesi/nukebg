import { createImageDataLike } from '../types/image-data-like.js';
import type { ImageDataLike } from '../types/image-data-like.js';

/**
 * Tight bounding-box crop on the subject (any pixel with alpha above
 * `alphaThreshold`).
 *
 * Moved from packages/nukebg-app/src/utils/auto-crop.ts in Phase 8.
 * `new ImageData(out, cw, ch)` replaced with `createImageDataLike(out, cw, ch)`.
 * No DOM globals used.
 */

export interface AutoCropOptions {
  /** Pixels with α >= this count as subject. Default 1 (any non-zero α). */
  alphaThreshold?: number;
  /** Extra pixels around the bbox. Default 0 (tight). */
  padding?: number;
}

export function autoCropToSubject(img: ImageDataLike, options: AutoCropOptions = {}): ImageDataLike {
  const threshold = options.alphaThreshold ?? 1;
  const padding = options.padding ?? 0;
  const { width: w, height: h, data } = img;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if ((data[(row + x) * 4 + 3] ?? 0) >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No subject pixels at all — return unchanged.
  if (maxX < 0) return img;

  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(w - 1, maxX + padding);
  const y1 = Math.min(h - 1, maxY + padding);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Subject already fills the canvas — skip the copy.
  if (cw === w && ch === h) return img;

  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = (y0 + y) * w * 4 + x0 * 4;
    const dstRow = y * cw * 4;
    out.set(data.subarray(srcRow, srcRow + cw * 4), dstRow);
  }
  return createImageDataLike(out, cw, ch);
}
