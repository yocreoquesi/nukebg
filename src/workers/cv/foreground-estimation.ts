/**
 * Multi-Level Foreground Estimation.
 *
 * Given an observed RGB image I and an alpha mask α, recovers the true
 * foreground color F such that I = α·F + (1−α)·B. This removes the halo
 * "color bleed" that soft-alpha segmentations leave on edge pixels: without
 * decontamination, a pixel with α=0.5 still carries 50% of the background
 * color in its RGB, which shows through as a grey/colored fringe when the
 * subject is composited onto a different background.
 *
 * Algorithm: simplified Germer et al. (2020) iterative solver with a
 * coarse-to-fine pyramid. At each pixel we solve a 2×2 linear system per
 * channel that balances the compositing constraint (I = αF + (1−α)B) with
 * a local smoothness prior (F and B should vary smoothly in space).
 *
 *   [α² + λ        α(1−α)    ] [F]   [α·I + λ·F̄]
 *   [α(1−α)       (1−α)² + λ ] [B] = [(1−α)·I + λ·B̄]
 *
 * F̄ and B̄ are box-filtered neighborhood means computed each iteration.
 * Solved in closed form via 2×2 inversion; no matrix library needed.
 */

const DEFAULT_ITERATIONS_PER_LEVEL = 6;
const DEFAULT_SMOOTHNESS_LAMBDA = 0.1;
const BOX_BLUR_RADIUS = 1;
// Pyramid depth: deeper = longer-range propagation of anchor colors into
// ambiguous bands. 8 gives ~5 levels on a typical 4–8 MP photo, which is
// enough for halos up to ~30 px wide to pull from opaque anchors.
const MIN_LEVEL_DIM = 8;

export interface ForegroundEstimationOptions {
  /** Iterations per pyramid level. Default 6. */
  iterationsPerLevel?: number;
  /** Smoothness prior weight. Higher = smoother F/B, less detail. Default 0.1. */
  lambda?: number;
}

/**
 * Estimate decontaminated foreground RGB from a mixed observation + alpha.
 *
 * Inputs:
 *   observed  — RGBA pixels of the original image (alpha channel ignored).
 *   alpha     — Uint8 alpha at the same resolution (0..255).
 *   width/height — dimensions.
 *
 * Returns a new Uint8ClampedArray (RGBA) where:
 *   - RGB is the estimated foreground (suitable for compositing on any bg).
 *   - Alpha is copied from the input alpha mask.
 *
 * Pixels with α near 1 are copied verbatim (already pure FG). Pixels with
 * α near 0 are skipped (invisible in output, their RGB doesn't matter).
 * Only edge pixels (partial α) run through the solver.
 */
export function estimateForeground(
  observed: Uint8ClampedArray,
  alpha: Uint8Array,
  width: number,
  height: number,
  opts: ForegroundEstimationOptions = {},
): Uint8ClampedArray {
  const iters = opts.iterationsPerLevel ?? DEFAULT_ITERATIONS_PER_LEVEL;
  const lambda = opts.lambda ?? DEFAULT_SMOOTHNESS_LAMBDA;

  const pyramid = buildPyramid(observed, alpha, width, height);

  // Initialize F = B = I at the coarsest level.
  const coarsest = pyramid[pyramid.length - 1];
  let F: Float32Array = new Float32Array(coarsest.width * coarsest.height * 3);
  let B: Float32Array = new Float32Array(coarsest.width * coarsest.height * 3);
  initializeFromImage(coarsest.image, F);
  initializeFromImage(coarsest.image, B);

  // Coarse-to-fine solve.
  for (let level = pyramid.length - 1; level >= 0; level--) {
    const { image, alpha: a, width: w, height: h } = pyramid[level];

    // Precompute α-weight buffers (opaque pixels should dominate F̄; transparent
    // pixels should dominate B̄). Without this weighting, F gets dragged toward
    // 0 by transparent pixels' F values — which are meaningless in regions
    // the model said have no foreground.
    const wF = new Float32Array(w * h);
    const wB = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const an = a[i] / 255;
      wF[i] = an;
      wB[i] = 1 - an;
    }

    for (let it = 0; it < iters; it++) {
      const Favg = weightedBoxBlur3(F, wF, w, h, BOX_BLUR_RADIUS);
      const Bavg = weightedBoxBlur3(B, wB, w, h, BOX_BLUR_RADIUS);
      solveIteration(image, a, F, B, Favg, Bavg, w, h, lambda);
    }

    // Upsample F and B to the next finer level (bilinear), unless we're at L0.
    if (level > 0) {
      const next = pyramid[level - 1];
      F = new Float32Array(upsample3(F, w, h, next.width, next.height));
      B = new Float32Array(upsample3(B, w, h, next.width, next.height));
    }
  }

  // Pack F into RGBA output. Pure-opaque pixels keep exact observed RGB
  // (no floating-point round-trip). Transparent pixels output zero RGB.
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i];
    out[i * 4 + 3] = a;
    if (a >= 254) {
      out[i * 4] = observed[i * 4];
      out[i * 4 + 1] = observed[i * 4 + 1];
      out[i * 4 + 2] = observed[i * 4 + 2];
    } else if (a <= 1) {
      // Invisible — leave RGB at zero.
    } else {
      out[i * 4] = Math.max(0, Math.min(255, Math.round(F[i * 3])));
      out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(F[i * 3 + 1])));
      out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(F[i * 3 + 2])));
    }
  }
  return out;
}

interface PyramidLevel {
  image: Uint8ClampedArray; // RGBA packed, but only RGB is used
  alpha: Uint8Array;
  width: number;
  height: number;
}

function buildPyramid(
  observed: Uint8ClampedArray,
  alpha: Uint8Array,
  width: number,
  height: number,
): PyramidLevel[] {
  const levels: PyramidLevel[] = [{ image: observed, alpha, width, height }];
  let w = width;
  let h = height;
  while (Math.min(w, h) >= MIN_LEVEL_DIM * 2) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const parent = levels[levels.length - 1];
    const nextImage = downsample2xRGBA(parent.image, parent.width, parent.height, nw, nh);
    const nextAlpha = downsample2xU8(parent.alpha, parent.width, parent.height, nw, nh);
    levels.push({ image: nextImage, alpha: nextAlpha, width: nw, height: nh });
    w = nw;
    h = nh;
  }
  return levels;
}

function initializeFromImage(image: Uint8ClampedArray, out: Float32Array): void {
  const n = out.length / 3;
  for (let i = 0; i < n; i++) {
    out[i * 3] = image[i * 4];
    out[i * 3 + 1] = image[i * 4 + 1];
    out[i * 3 + 2] = image[i * 4 + 2];
  }
}

/**
 * Single Jacobi iteration of the per-pixel 2×2 solve.
 * Updates F and B in place using the current F̄ and B̄ neighborhood means.
 */
function solveIteration(
  image: Uint8ClampedArray,
  alpha: Uint8Array,
  F: Float32Array,
  B: Float32Array,
  Favg: Float32Array,
  Bavg: Float32Array,
  width: number,
  height: number,
  lambda: number,
): void {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const aN = alpha[i] / 255;
    const inv = 1 - aN;

    const a11 = aN * aN + lambda;
    const a22 = inv * inv + lambda;
    const a12 = aN * inv;
    const det = a11 * a22 - a12 * a12;
    if (det < 1e-6) continue; // degenerate; skip this pixel

    for (let ch = 0; ch < 3; ch++) {
      const ii = image[i * 4 + ch];
      const rf = aN * ii + lambda * Favg[i * 3 + ch];
      const rb = inv * ii + lambda * Bavg[i * 3 + ch];
      const newF = (rf * a22 - rb * a12) / det;
      const newB = (rb * a11 - rf * a12) / det;
      F[i * 3 + ch] = newF;
      B[i * 3 + ch] = newB;
    }
  }
}

/**
 * α-weighted 3-channel box blur: F̄[i] = Σ_N (w_j · F_j) / Σ_N (w_j).
 * Falls back to the nearest-neighbor value when the weight sum is zero to
 * avoid producing NaN at pixels whose entire neighborhood has zero weight.
 */
function weightedBoxBlur3(
  src: Float32Array,
  weights: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(src.length);
  const r = radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let wsum = 0;
      let sr = 0,
        sg = 0,
        sb = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yi = Math.min(Math.max(y + dy, 0), height - 1);
        for (let dx = -r; dx <= r; dx++) {
          const xi = Math.min(Math.max(x + dx, 0), width - 1);
          const ni = yi * width + xi;
          const wv = weights[ni];
          if (wv === 0) continue;
          wsum += wv;
          sr += wv * src[ni * 3];
          sg += wv * src[ni * 3 + 1];
          sb += wv * src[ni * 3 + 2];
        }
      }
      const oi = y * width + x;
      if (wsum > 1e-6) {
        out[oi * 3] = sr / wsum;
        out[oi * 3 + 1] = sg / wsum;
        out[oi * 3 + 2] = sb / wsum;
      } else {
        out[oi * 3] = src[oi * 3];
        out[oi * 3 + 1] = src[oi * 3 + 1];
        out[oi * 3 + 2] = src[oi * 3 + 2];
      }
    }
  }
  return out;
}

/** Bilinear upsample of a 3-channel interleaved Float32 buffer. */
function upsample3(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH * 3);
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

      for (let ch = 0; ch < 3; ch++) {
        const a = src[(y0 * srcW + x0) * 3 + ch];
        const b = src[(y0 * srcW + x1) * 3 + ch];
        const c = src[(y1 * srcW + x0) * 3 + ch];
        const d = src[(y1 * srcW + x1) * 3 + ch];
        const top = a + (b - a) * dx;
        const bot = c + (d - c) * dx;
        dst[(y * dstW + x) * 3 + ch] = top + (bot - top) * dy;
      }
    }
  }

  return dst;
}

/** 2× downsample of an RGBA buffer into (dstW × dstH) using 2×2 averaging. */
function downsample2xRGBA(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.min(y * 2, srcH - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.min(x * 2, srcW - 1);
      const x1 = Math.min(x0 + 1, srcW - 1);
      for (let ch = 0; ch < 3; ch++) {
        const s =
          src[(y0 * srcW + x0) * 4 + ch] +
          src[(y0 * srcW + x1) * 4 + ch] +
          src[(y1 * srcW + x0) * 4 + ch] +
          src[(y1 * srcW + x1) * 4 + ch];
        dst[(y * dstW + x) * 4 + ch] = (s + 2) >> 2;
      }
      dst[(y * dstW + x) * 4 + 3] = 255;
    }
  }
  return dst;
}

/** 2× downsample of a Uint8 buffer using 2×2 averaging. */
function downsample2xU8(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.min(y * 2, srcH - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.min(x * 2, srcW - 1);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const s =
        src[y0 * srcW + x0] + src[y0 * srcW + x1] + src[y1 * srcW + x0] + src[y1 * srcW + x1];
      dst[y * dstW + x] = (s + 2) >> 2;
    }
  }
  return dst;
}
