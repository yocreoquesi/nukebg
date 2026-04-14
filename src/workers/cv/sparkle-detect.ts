import { SPARKLE_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';

/**
 * Shape-based Gemini sparkle detector.
 *
 * Detects the 4-pointed star (✦) Gemini watermark by multiple strict shape
 * invariants, regardless of background uniformity or sparkle opacity:
 *   1. Bright center pixel (local peak)
 *   2. 4 cardinal arms (N/S/E/W) much brighter than 4 diagonal gaps
 *   3. 4-fold rotational symmetry — cardinals must be similar to each other
 *   4. Compact relative size (~2-4% of shorter image dimension)
 *
 * Gates (per candidate (cy, cx, r)):
 *   G1: min(cardinals) - max(gaps) > MIN_ARM_GAP_DELTA
 *       (even the weakest arm beats the strongest gap by a margin — rejects
 *       asymmetric bright features like edges and reflections)
 *   G2: std(cardinals) / mean(cardinals) < MAX_ARM_CV
 *       (4-fold rotational symmetry — rejects lopsided bright spots)
 *   G3: center >= mean(cardinals) * CENTER_PEAK_RATIO
 *       (center is the peak — rejects donut-shaped features)
 *   G4: center - mean(outerRing) > MIN_CENTER_CONTRAST
 *       (sparkle is brighter than its local background)
 *   G5: max(perpToArm) <= mean(cardinals) * MAX_PERP_ARM_RATIO
 *       (arms are narrow lines — rejects solid shapes like the NukeBG
 *       trefoil, motorcycle rotors, and bold text characters whose "arms"
 *       are wide blades with bright neighboring pixels)
 *   G6: r in [MIN_REL_R, MAX_REL_R] * min(W,H)
 *       (Gemini renders at a fixed relative size)
 *
 * Only candidates passing ALL gates compete by starness score:
 *   score = (mean(cardinals) - mean(gaps)) * (center - mean(outer))
 */
export function sparkleDetect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkResult {
  const minDim = Math.min(width, height);
  const minR = SPARKLE_PARAMS.MIN_RELATIVE_RADIUS * minDim;
  const maxR = SPARKLE_PARAMS.MAX_RELATIVE_RADIUS * minDim;

  // Drop scales outside the relative-size band AND those that don't fit
  const scales = SPARKLE_PARAMS.SCALE_RADII.filter(
    (r) => r >= minR && r <= maxR && minDim >= r * 4,
  );
  if (scales.length === 0) {
    return { detected: false, mask: null };
  }
  const maxScale = scales[scales.length - 1];

  // Pre-compute luminance grid (Rec. 601)
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    lum[j] = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
  }

  // Scan area: bottom-right corner. Inset by the smallest scale's outer ring;
  // per-candidate we filter scales that don't fit at that position.
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

  const scaleMargins = scales.map((r) => Math.ceil(r * 1.5) + 1);

  // Pre-derive per-scale sample offsets
  type Offsets = {
    arm: [number, number][];
    perp: [number, number][];
    gap: [number, number][];
    outer: [number, number][];
  };
  const offsetsByScale: Offsets[] = scales.map((r) => {
    const arm = Math.round(r * 0.6);
    const perp = Math.round(r * 0.35);
    const gap = Math.round(r * 0.424);
    const outerC = Math.round(r * 1.5);
    const outerD = Math.round(r * 1.06);
    return {
      arm: [[-arm, 0], [arm, 0], [0, -arm], [0, arm]],
      // Two perpendicular samples per arm (8 total) — arms are narrow lines,
      // so perpendicular offsets land in dark gap territory for a real sparkle.
      perp: [
        [-arm, -perp], [-arm, perp],  // north arm sides
        [arm, -perp], [arm, perp],    // south arm sides
        [-perp, arm], [perp, arm],    // east arm sides
        [-perp, -arm], [perp, -arm],  // west arm sides
      ],
      gap: [[-gap, -gap], [-gap, gap], [gap, -gap], [gap, gap]],
      outer: [
        [-outerC, 0], [outerC, 0], [0, -outerC], [0, outerC],
        [-outerD, -outerD], [-outerD, outerD], [outerD, -outerD], [outerD, outerD],
      ],
    };
  });

  let bestScore = 0;
  let bestY = -1, bestX = -1, bestR = 0;
  const stride = SPARKLE_PARAMS.CANDIDATE_STRIDE;

  for (let cy = yStart; cy < yEnd; cy += stride) {
    for (let cx = xStart; cx < xEnd; cx += stride) {
      const c = lum[cy * width + cx];

      for (let si = 0; si < scales.length; si++) {
        const m = scaleMargins[si];
        if (cy - m < 0 || cy + m >= height || cx - m < 0 || cx + m >= width) continue;
        const off = offsetsByScale[si];

        // Sample cardinals individually (4-fold symmetry check)
        const a0 = lum[(cy + off.arm[0][0]) * width + (cx + off.arm[0][1])];
        const a1 = lum[(cy + off.arm[1][0]) * width + (cx + off.arm[1][1])];
        const a2 = lum[(cy + off.arm[2][0]) * width + (cx + off.arm[2][1])];
        const a3 = lum[(cy + off.arm[3][0]) * width + (cx + off.arm[3][1])];

        // Sample diagonals individually
        const d0 = lum[(cy + off.gap[0][0]) * width + (cx + off.gap[0][1])];
        const d1 = lum[(cy + off.gap[1][0]) * width + (cx + off.gap[1][1])];
        const d2 = lum[(cy + off.gap[2][0]) * width + (cx + off.gap[2][1])];
        const d3 = lum[(cy + off.gap[3][0]) * width + (cx + off.gap[3][1])];

        // G1: min(arms) > max(gaps) + margin
        const minA = Math.min(a0, a1, a2, a3);
        const maxD = Math.max(d0, d1, d2, d3);
        if (minA - maxD < SPARKLE_PARAMS.MIN_ARM_GAP_DELTA) continue;

        // G2: coefficient of variation cap on cardinals
        const meanA = (a0 + a1 + a2 + a3) / 4;
        if (meanA < 1) continue;
        const varA =
          ((a0 - meanA) * (a0 - meanA) +
            (a1 - meanA) * (a1 - meanA) +
            (a2 - meanA) * (a2 - meanA) +
            (a3 - meanA) * (a3 - meanA)) / 4;
        const stdA = Math.sqrt(varA);
        if (stdA / meanA > SPARKLE_PARAMS.MAX_ARM_CV) continue;

        // G3: center peak
        if (c < meanA * SPARKLE_PARAMS.CENTER_PEAK_RATIO) continue;

        // G4: contrast vs outer ring
        let oSum = 0;
        for (const [dy, dx] of off.outer) {
          oSum += lum[(cy + dy) * width + (cx + dx)];
        }
        const meanO = oSum / 8;
        const cMinusO = c - meanO;
        if (cMinusO < SPARKLE_PARAMS.MIN_CENTER_CONTRAST) continue;

        // G5: arm-isolation. Perpendicular offsets from each arm must be
        // darker than the arm mean — real sparkle arms are narrow lines, not
        // wide blades. Rejects the NukeBG trefoil, motorcycle rotors, and
        // heavy text characters, which all have "arms" that are actually
        // wide solid regions with bright neighboring pixels.
        let maxPerp = 0;
        for (const [dy, dx] of off.perp) {
          const v = lum[(cy + dy) * width + (cx + dx)];
          if (v > maxPerp) maxPerp = v;
        }
        if (maxPerp > meanA * SPARKLE_PARAMS.MAX_PERP_ARM_RATIO) continue;

        // Score: picks the strongest candidate among those that passed all gates
        const meanD = (d0 + d1 + d2 + d3) / 4;
        const score = (meanA - meanD) * cMinusO;
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
