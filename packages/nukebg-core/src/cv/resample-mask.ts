// Shared RMBG mask resampler — the single source of truth for resizing a
// model-resolution mask to the target image resolution. Mirrors the browser
// `ml.worker.ts` bilinear resize (~L499-500), including the pixel-CENTER
// offset `fx = x*scaleX - 0.5`, `fy = y*scaleY - 0.5`. Dropping that offset
// shifts the mask by half a pixel and mis-aligns edges (review #5/#7).

/**
 * Bilinear resample of a single-channel mask from src dims to dst dims,
 * using the pixel-center offset so sample points land on pixel centers.
 * Identity dims short-circuit to an exact copy (no edge extrapolation).
 *
 * @param mask source mask, length `srcW * srcH`
 * @returns resampled mask, length `dstW * dstH`
 */
export function resampleMask(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(mask);

  const out = new Uint8Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    // Pixel-center offset: sample the center of the destination pixel.
    const fy = y * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = fy - y0;

    for (let x = 0; x < dstW; x++) {
      const fx = x * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = fx - x0;

      const v00 = mask[y0 * srcW + x0] ?? 0;
      const v10 = mask[y0 * srcW + x1] ?? 0;
      const v01 = mask[y1 * srcW + x0] ?? 0;
      const v11 = mask[y1 * srcW + x1] ?? 0;

      const top = v00 + (v10 - v00) * dx;
      const bot = v01 + (v11 - v01) * dx;
      out[y * dstW + x] = Math.round(top + (bot - top) * dy);
    }
  }
  return out;
}
