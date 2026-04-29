import { SPARKLE_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';

/** Returns true when the pixel matches the Gemini sparkle palette: a
 *  bright low-saturation (or slight-cyan-tint) pixel. The `max` floor is
 *  configurable (`SPARKLE_PARAMS.PALETTE_MIN_MAX`) so dim/aliased ✦ glyphs
 *  on JPEG-compressed photos still match. Saturation cap rejects skin
 *  tones, grass, and other colored objects so the flood-fill doesn't walk
 *  out of the sparkle into the subject. */
function isGeminiSparkleColor(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  if (max < SPARKLE_PARAMS.PALETTE_MIN_MAX) return false;
  const min = Math.min(r, g, b);
  const saturation = max - min;
  if (saturation <= 35) return true;
  if (b >= r && b >= g && r >= 180 && g >= 180) return true;
  return false;
}

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
      arm: [
        [-arm, 0],
        [arm, 0],
        [0, -arm],
        [0, arm],
      ],
      // Two perpendicular samples per arm (8 total) — arms are narrow lines,
      // so perpendicular offsets land in dark gap territory for a real sparkle.
      perp: [
        [-arm, -perp],
        [-arm, perp], // north arm sides
        [arm, -perp],
        [arm, perp], // south arm sides
        [-perp, arm],
        [perp, arm], // east arm sides
        [-perp, -arm],
        [perp, -arm], // west arm sides
      ],
      gap: [
        [-gap, -gap],
        [-gap, gap],
        [gap, -gap],
        [gap, gap],
      ],
      outer: [
        [-outerC, 0],
        [outerC, 0],
        [0, -outerC],
        [0, outerC],
        [-outerD, -outerD],
        [-outerD, outerD],
        [outerD, -outerD],
        [outerD, outerD],
      ],
    };
  });

  let bestScore = 0;
  let bestY = -1,
    bestX = -1,
    bestR = 0;
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
            (a3 - meanA) * (a3 - meanA)) /
          4;
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

  // Build the mask via palette-cluster centroid + bbox-derived radius.
  // Port of the proven legacy `watermarkDetect` mask-building from the
  // 984b578b deploy: scan the bottom-right corner, collect every
  // palette-matching pixel, anchor a circular mask on their centroid
  // with radius derived from their bounding box.
  //
  // Why this is the right strategy after shape detection passes:
  //   - Shape detector's `(bestY, bestX)` comes from the score landscape
  //     of the 4-arm pattern — it can be 30-50 px off the visual centroid
  //     of the rendered glyph (the on-axis cardinal arm + bright sky
  //     interference can produce a high score off the real peak).
  //   - The cluster centroid IS, by construction, the visual centroid of
  //     the bright palette pixels. The bbox tells us how far the glyph
  //     extends, regardless of which `bestR` the detector picked.
  //   - The CORE of the mask (`radius * MASK_RADIUS_MULTIPLIER`) is solid
  //     and unconditional — covers the entire glyph, including the
  //     anti-aliased on-skin half whose pixels don't pass the palette
  //     gate themselves. This is what makes the legacy approach work
  //     where the shape-polygon failed.
  //
  // False-positive risk that originally retired the legacy detector
  // (motorcycle chrome, skin highlights) is neutralized here because
  // the 4-arm shape gates G1-G6 above already qualified the input as
  // a real Gemini ✦ before this code runs.
  // Scan a generous window around the shape detector's `(bestY, bestX)`
  // — NOT the whole corner. The shape gates G1-G6 already qualified
  // the input as a real Gemini ✦, so we only need to focus on pixels
  // near it. A whole-corner sweep is contaminated by unrelated bright
  // clusters (clothing highlights, sun-lit foliage) which drag the
  // centroid 80-100 px off the true sparkle.
  const scanR = Math.max(
    bestR * SPARKLE_PARAMS.CLUSTER_SCAN_RADIUS_MULTIPLIER,
    SPARKLE_PARAMS.CLUSTER_SCAN_RADIUS_MIN,
  );
  const scanY0 = Math.max(0, bestY - scanR);
  const scanY1 = Math.min(height, bestY + scanR + 1);
  const scanX0 = Math.max(0, bestX - scanR);
  const scanX1 = Math.min(width, bestX + scanR + 1);
  let sumY = 0;
  let sumX = 0;
  let cMinY = Infinity;
  let cMaxY = -Infinity;
  let cMinX = Infinity;
  let cMaxX = -Infinity;
  let clusterCount = 0;
  for (let y = scanY0; y < scanY1; y++) {
    const row = y * width;
    for (let x = scanX0; x < scanX1; x++) {
      const pi = (row + x) * 4;
      if (!isGeminiSparkleColor(pixels[pi], pixels[pi + 1], pixels[pi + 2])) continue;
      sumY += y;
      sumX += x;
      if (y < cMinY) cMinY = y;
      if (y > cMaxY) cMaxY = y;
      if (x < cMinX) cMinX = x;
      if (x > cMaxX) cMaxX = x;
      clusterCount++;
    }
  }

  const mask = new Uint8Array(width * height);
  if (clusterCount < SPARKLE_PARAMS.CLUSTER_MIN_PALETTE_PIXELS) {
    // Shape-detect passed but the palette cluster is degenerate. Refuse
    // to build a mask rather than guess — the inpaint stage will see
    // an empty mask and skip cleanly.
    // eslint-disable-next-line no-console
    console.warn(
      `[NukeBG sparkle v=cluster-1] bestR=${bestR} det=(${bestY},${bestX}) ` +
        `cluster=${clusterCount} (below MIN_PALETTE_PIXELS) — no mask built`,
    );
    return { detected: true, mask, centerX: bestX, centerY: bestY, radius: bestR };
  }

  const cyAbs = Math.round(sumY / clusterCount);
  const cxAbs = Math.round(sumX / clusterCount);
  const bboxHalfExtent = Math.floor(Math.max(cMaxY - cMinY, cMaxX - cMinX) / 2);
  const rawRadius = bboxHalfExtent + SPARKLE_PARAMS.CLUSTER_BBOX_BUFFER_PX;
  const maskRadius = Math.min(
    Math.round(rawRadius * SPARKLE_PARAMS.MASK_RADIUS_MULTIPLIER),
    SPARKLE_PARAMS.CLUSTER_MAX_RADIUS_ABS_CAP,
  );
  const maskRadius2 = maskRadius * maskRadius;

  const y0 = Math.max(0, cyAbs - maskRadius);
  const y1 = Math.min(height - 1, cyAbs + maskRadius);
  const x0 = Math.max(0, cxAbs - maskRadius);
  const x1 = Math.min(width - 1, cxAbs + maskRadius);
  let maskCount = 0;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cyAbs;
    const dy2 = dy * dy;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cxAbs;
      if (dx * dx + dy2 <= maskRadius2) {
        mask[row + x] = 1;
        maskCount++;
      }
    }
  }

  // Diagnostic log — palette-cluster strategy. Tagged `v=cluster-1` so
  // a stale Service Worker bundle is identifiable by the missing prefix.
  // Logged unconditionally (visible in preview/production builds) while
  // we stabilize this on real photos. One line per image, no PII.
  // eslint-disable-next-line no-console
  console.warn(
    `[NukeBG sparkle v=cluster-1] bestR=${bestR} det=(${bestY},${bestX}) ` +
      `centroid=(${cyAbs},${cxAbs}) cluster=${clusterCount} ` +
      `bbox=${cMaxY - cMinY}x${cMaxX - cMinX} maskRadius=${maskRadius} maskPx=${maskCount}`,
  );

  return {
    detected: true,
    mask,
    centerX: cxAbs,
    centerY: cyAbs,
    radius: maskRadius,
  };
}
