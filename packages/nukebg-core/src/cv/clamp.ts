/**
 * Clamp a number into the byte range [0, 255] and round to integer.
 *
 * Float→Uint8ClampedArray writes auto-clamp + round under the hood, so
 * skipping this helper does NOT corrupt output today. We use it where
 * the pixel arithmetic produces floats (bilinear interpolation, alpha
 * blending with noise) so the intent is explicit at the call site and
 * a NaN doesn't silently become 0 if upstream math ever drifts.
 *
 * Extracted from `foreground-estimation.ts` and applied in
 * `inpaint-blend.ts` + `lama-crop.ts` per #194.
 */
export function clamp255(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
