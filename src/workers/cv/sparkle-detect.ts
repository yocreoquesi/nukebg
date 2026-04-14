import { SPARKLE_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';

/**
 * Shape-based Gemini sparkle detector.
 *
 * Detects the 4-pointed star (✦) Gemini watermark by its three invariant
 * features, regardless of background uniformity or sparkle opacity:
 *   1. Bright center (locally brighter than far ring)
 *   2. Cardinal arms (N/S/E/W) brighter than diagonal gaps (NE/NW/SE/SW)
 *   3. 4-fold rotational symmetry, compact size
 *
 * Score per candidate (cy, cx, r):
 *   starness = max(0, A - D) * max(0, C - O)
 *     C = center luminance
 *     A = mean luminance at 4 cardinal arm samples (radius ~0.6r)
 *     D = mean luminance at 4 diagonal gap samples (same radial distance)
 *     O = mean luminance at 8 outer ring samples (radius ~1.5r) — bg reference
 *
 * Sweeps a multi-scale grid in the bottom-right corner and picks the best.
 */
export function sparkleDetect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkResult {
  // Drop scales that don't fit (outer ring at 1.5r would land outside the image).
  // We need at least 4 * r of room across the shorter dimension to allow a
  // reasonable scan area after insetting for the outer-ring samples.
  const minDim = Math.min(width, height);
  const scales = SPARKLE_PARAMS.SCALE_RADII.filter((r) => minDim >= r * 4);
  if (scales.length === 0) {
    return { detected: false, mask: null };
  }
  const maxScale = scales[scales.length - 1];

  // Pre-compute luminance grid (Rec. 601)
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    lum[j] = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
  }

  // Scan area: bottom-right corner. Inset only by the SMALLEST scale's outer
  // ring; per-candidate we filter scales that don't fit at that position.
  const minScale = scales[0];
  const minMargin = Math.ceil(minScale * 1.6);
  const scanW = Math.max(maxScale * 2, Math.floor(width * SPARKLE_PARAMS.SCAN_WIDTH_FRACTION));
  const scanH = Math.max(maxScale * 2, Math.floor(height * SPARKLE_PARAMS.SCAN_HEIGHT_FRACTION));
  const xStart = Math.max(minMargin, width - scanW);
  const xEnd = width - minMargin;
  const yStart = Math.max(minMargin, height - scanH);
  const yEnd = height - minMargin;

  if (xEnd <= xStart || yEnd <= yStart) {
    return { detected: false, mask: null };
  }

  // Per-scale max margin for bounds check (= 1.5r + 1)
  const scaleMargins = scales.map((r) => Math.ceil(r * 1.5) + 1);

  let bestScore = 0;
  let bestY = -1, bestX = -1, bestR = 0;
  const stride = SPARKLE_PARAMS.CANDIDATE_STRIDE;

  // Pre-derive sample offsets per scale to avoid repeated math in inner loop.
  // Cardinal arm samples at 0.6r; diagonal gaps at the same radial distance
  // but rotated 45° (so cartesian offset = 0.6r / sqrt(2) ≈ 0.424r).
  // Outer ring at 1.5r (cardinal) and 1.06r diagonal.
  type Offsets = {
    arm: [number, number][];
    gap: [number, number][];
    outer: [number, number][];
  };
  const offsetsByScale: Offsets[] = scales.map((r) => {
    const arm = Math.round(r * 0.6);
    const gap = Math.round(r * 0.424);
    const outerC = Math.round(r * 1.5);
    const outerD = Math.round(r * 1.06);
    return {
      arm: [
        [-arm, 0], [arm, 0], [0, -arm], [0, arm],
      ],
      gap: [
        [-gap, -gap], [-gap, gap], [gap, -gap], [gap, gap],
      ],
      outer: [
        [-outerC, 0], [outerC, 0], [0, -outerC], [0, outerC],
        [-outerD, -outerD], [-outerD, outerD], [outerD, -outerD], [outerD, outerD],
      ],
    };
  });

  for (let cy = yStart; cy < yEnd; cy += stride) {
    for (let cx = xStart; cx < xEnd; cx += stride) {
      const c = lum[cy * width + cx];

      for (let si = 0; si < scales.length; si++) {
        // Bounds check: skip scales whose outer ring would land outside
        const m = scaleMargins[si];
        if (cy - m < 0 || cy + m >= height || cx - m < 0 || cx + m >= width) continue;

        const off = offsetsByScale[si];

        let aSum = 0;
        for (const [dy, dx] of off.arm) {
          aSum += lum[(cy + dy) * width + (cx + dx)];
        }
        const a = aSum / 4;

        let dSum = 0;
        for (const [dy, dx] of off.gap) {
          dSum += lum[(cy + dy) * width + (cx + dx)];
        }
        const d = dSum / 4;

        // Concavity check first — cheap reject
        const armMinusGap = a - d;
        if (armMinusGap <= 0) continue;

        let oSum = 0;
        for (const [dy, dx] of off.outer) {
          oSum += lum[(cy + dy) * width + (cx + dx)];
        }
        const o = oSum / 8;

        const centerMinusOuter = c - o;
        if (centerMinusOuter <= 0) continue;

        const score = armMinusGap * centerMinusOuter;
        if (score > bestScore) {
          bestScore = score;
          bestY = cy;
          bestX = cx;
          bestR = scales[si];
        }
      }
    }
  }

  if (bestScore < SPARKLE_PARAMS.MIN_STARNESS || bestY < 0) {
    return { detected: false, mask: null };
  }

  // Build circular mask
  const mask = new Uint8Array(width * height);
  const maskR = Math.ceil(bestR * SPARKLE_PARAMS.MASK_RADIUS_MULTIPLIER);
  const maskR2 = maskR * maskR;
  const y0 = Math.max(0, bestY - maskR);
  const y1 = Math.min(height, bestY + maskR + 1);
  const x0 = Math.max(0, bestX - maskR);
  const x1 = Math.min(width, bestX + maskR + 1);
  for (let y = y0; y < y1; y++) {
    const dy = y - bestY;
    const dy2 = dy * dy;
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const dx = x - bestX;
      if (dx * dx + dy2 <= maskR2) {
        mask[row + x] = 1;
      }
    }
  }

  return {
    detected: true,
    mask,
    centerX: bestX,
    centerY: bestY,
    radius: bestR,
  };
}
