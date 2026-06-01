/**
 * Tight bounding-box crop on the subject (any pixel with alpha above
 * `alphaThreshold`).
 *
 * The pipeline preserves the original canvas size — every transparent
 * pixel outside the subject is still in the output buffer, just with
 * α=0. That's good for the before/after slider (canvases align) but
 * wasteful for export: a 1920×1080 photo with a 200×200 subject ships a
 * 1920×1080 PNG.
 *
 * `autoCropToSubject` returns a fresh ImageData clipped to the subject's
 * bbox so the downloaded file is just the meaningful pixels — sized
 * right for emotes, stickers, profile pictures.
 *
 * Edge cases:
 *   - all-transparent: returns the input unchanged. There's no subject
 *     to crop to and a 0×0 PNG is useless.
 *   - all-opaque (bbox == full image): returns the input unchanged. No
 *     allocation cost paid for a no-op.
 *   - threshold default 1: any non-zero α counts as subject. The
 *     pipeline's quintic sharpenAlpha already kills halos to α=0, so
 *     α>0 lands on actual antialiased edge — cropping there preserves
 *     the soft transition on a clean transparent background.
 */
export interface AutoCropOptions {
  /** Pixels with α >= this count as subject. Default 1 (any non-zero α). */
  alphaThreshold?: number;
  /** Extra pixels around the bbox. Default 0 (tight). */
  padding?: number;
}

export function autoCropToSubject(img: ImageData, options: AutoCropOptions = {}): ImageData {
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
      if (data[(row + x) * 4 + 3] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No subject pixels at all — return unchanged. A 0×0 PNG is useless.
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
  return new ImageData(out, cw, ch);
}
