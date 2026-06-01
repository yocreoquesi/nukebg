/**
 * PatchMatch-based image inpainting.
 *
 * Implements the Barnes et al. 2009 randomized nearest-neighbor field
 * (NNF) search combined with Wexler-style iterative voting reconstruction
 * to fill masked regions with texture copied from elsewhere in the image.
 *
 * Algorithm overview (single-scale):
 *   1. For each pixel inside the mask, pick a random SOURCE coordinate
 *      outside the mask (the "nearest neighbor" guess).
 *   2. Iterate ITERATIONS times:
 *      a. PROPAGATION — check whether the neighbours' source offsets give
 *         a better match for this patch.
 *      b. RANDOM SEARCH — try a few candidates in an exponentially
 *         shrinking window around the current source guess.
 *      c. VOTE — rebuild masked pixels as a weighted average of the
 *         source patches pointed to by the NNF.
 *   3. Repeat. Each iteration refines both the NNF (better matches) and
 *      the reconstructed content (because subsequent distance
 *      computations see the improved voted output).
 *
 * For NukeBG's use case (Gemini sparkle ≤100 px on a selfie) single-scale
 * with 4-6 iterations converges well and runs in ~1-3 s on a typical 2MP
 * photo. Multi-scale (Wexler pyramid) can be added later if needed.
 *
 * Unlike Telea FMM (which radially propagates colour and leaves a visible
 * "fan"), PatchMatch copies actual image content and therefore preserves
 * both structure AND texture.
 */

export interface PatchMatchOptions {
  /** Number of outer refinement iterations (each includes propagation +
   *  random search + vote). 4-6 is typical. */
  iterations: number;
  /** Half-width of the square patch. 3 → 7×7 window. */
  patchRadius: number;
  /**
   * Optional binary mask marking pixels that ARE allowed to serve as source
   * patches. When absent, every non-masked pixel is usable. Use this to
   * exclude the subject (e.g. pass the inverse of an RMBG mask) or to limit
   * the search to a ring around the hole.
   */
  searchRegion?: Uint8Array;
  /** Fixed seed for deterministic output (tests). */
  seed?: number;
}

/* ───────────────────────── Utilities ───────────────────────── */

/** xorshift32 PRNG so tests can be deterministic when seed is set. */
function makeRng(seed: number) {
  let s = seed | 0;
  if (s === 0) s = 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Returns true iff a `patchRadius`-patch centred at (x, y) fits in the
 *  image bounds. */
function fits(x: number, y: number, w: number, h: number, r: number): boolean {
  return x >= r && x < w - r && y >= r && y < h - r;
}

/**
 * Sum-of-squared-differences between the two patches centred at (ax, ay)
 * in image A and (bx, by) in image B. Ignores the alpha channel.
 *
 * Exported so the test suite can verify the distance metric in isolation.
 */
export function patchDistance(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  aw: number,
  _ah: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  patchRadius: number,
): number {
  let sum = 0;
  for (let dy = -patchRadius; dy <= patchRadius; dy++) {
    for (let dx = -patchRadius; dx <= patchRadius; dx++) {
      const ai = ((ay + dy) * aw + (ax + dx)) * 4;
      const bi = ((by + dy) * aw + (bx + dx)) * 4;
      const dr = a[ai] - b[bi];
      const dg = a[ai + 1] - b[bi + 1];
      const db = a[ai + 2] - b[bi + 2];
      sum += dr * dr + dg * dg + db * db;
    }
  }
  return sum;
}

/**
 * Build the initial NNF: for every pixel inside `mask`, pick a random
 * source coordinate that (a) is not itself masked, (b) has a valid
 * `patchRadius` patch window. Unmasked pixels get the identity mapping.
 *
 * Returns a flat Int32Array of length width*height*2 in (x, y) pairs.
 */
export function initNNF(
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  searchRegion?: Uint8Array,
  rng: () => number = Math.random,
): Int32Array {
  const nnf = new Int32Array(width * height * 2);
  const validX = width - patchRadius;
  const validY = height - patchRadius;
  const validSpanX = validX - patchRadius;
  const validSpanY = validY - patchRadius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) {
        nnf[idx * 2] = x;
        nnf[idx * 2 + 1] = y;
        continue;
      }
      // Reject-sample a valid source
      let sx = 0,
        sy = 0,
        tries = 0;
      do {
        sx = patchRadius + Math.floor(rng() * validSpanX);
        sy = patchRadius + Math.floor(rng() * validSpanY);
        tries++;
        if (tries > 256) break;
      } while (mask[sy * width + sx] || (searchRegion && !searchRegion[sy * width + sx]));
      nnf[idx * 2] = sx;
      nnf[idx * 2 + 1] = sy;
    }
  }
  return nnf;
}

/* ───────────────────────── Main algorithm ───────────────────────── */

/**
 * Inpaint the `mask` region of `src` using single-scale PatchMatch with
 * Wexler-style voting reconstruction.
 *
 * @returns A new Uint8ClampedArray (same length as src) with masked pixels
 *          filled in. Unmasked pixels are copied from src byte-for-byte.
 */
export function patchMatchInpaint(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  opts: PatchMatchOptions,
): Uint8ClampedArray {
  const { iterations, patchRadius, searchRegion, seed } = opts;
  const rng = seed !== undefined ? makeRng(seed) : Math.random;

  // Working image: starts as src, masked pixels will be rewritten each vote.
  const work = new Uint8ClampedArray(src);
  // Seed masked pixels with the mean of surrounding unmasked pixels so the
  // distance metric has something reasonable to compare against on pass 1.
  seedMaskedWithLocalMean(work, width, height, mask);

  const nnf = initNNF(width, height, mask, patchRadius, searchRegion, rng);
  const dist = new Float64Array(width * height);
  computeInitialDistances(work, width, height, mask, patchRadius, nnf, dist);

  const maxRadius = Math.max(width, height);

  for (let iter = 0; iter < iterations; iter++) {
    // Alternate scan direction between passes for fast propagation.
    const forward = (iter & 1) === 0;
    patchMatchPass(
      work,
      width,
      height,
      mask,
      patchRadius,
      nnf,
      dist,
      searchRegion,
      rng,
      forward,
      maxRadius,
    );
    voteReconstruct(src, work, width, height, mask, patchRadius, nnf);
    // Distances are stale after voting; recompute for masked pixels.
    recomputeMaskedDistances(work, width, height, mask, patchRadius, nnf, dist);
  }

  // Preserve alpha at 255 inside masked region.
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) work[i * 4 + 3] = 255;
  }
  // Guarantee unmasked pixels are byte-exact with src (vote shouldn't touch
  // them, but be defensive for the test that enforces this).
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    const p = i * 4;
    work[p] = src[p];
    work[p + 1] = src[p + 1];
    work[p + 2] = src[p + 2];
    work[p + 3] = src[p + 3];
  }
  return work;
}

/* ───────────────────────── Internals ───────────────────────── */

/** Fill masked pixels with the mean colour of the unmasked pixels inside
 *  a local window. Gives the distance metric a sensible starting point on
 *  pass 1, otherwise the initial random NNF dominates the output. */
function seedMaskedWithLocalMean(
  img: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): void {
  // Find mask bounding box
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return;
  // Take a ring around the bbox as reference
  const pad = Math.max(8, Math.floor(Math.max(maxX - minX, maxY - minY) * 0.5));
  const rx0 = Math.max(0, minX - pad),
    rx1 = Math.min(width - 1, maxX + pad);
  const ry0 = Math.max(0, minY - pad),
    ry1 = Math.min(height - 1, maxY + pad);
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      if (mask[y * width + x]) continue;
      const i = (y * width + x) * 4;
      r += img[i];
      g += img[i + 1];
      b += img[i + 2];
      n++;
    }
  }
  if (n === 0) return;
  r = (r / n) | 0;
  g = (g / n) | 0;
  b = (b / n) | 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    img[p] = r;
    img[p + 1] = g;
    img[p + 2] = b;
    img[p + 3] = 255;
  }
}

function computeInitialDistances(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  nnf: Int32Array,
  dist: Float64Array,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) {
        dist[idx] = 0;
        continue;
      }
      if (!fits(x, y, width, height, patchRadius)) {
        dist[idx] = Infinity;
        continue;
      }
      const sx = nnf[idx * 2],
        sy = nnf[idx * 2 + 1];
      dist[idx] = patchDistance(work, work, width, height, x, y, sx, sy, patchRadius);
    }
  }
}

function recomputeMaskedDistances(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  nnf: Int32Array,
  dist: Float64Array,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      if (!fits(x, y, width, height, patchRadius)) continue;
      const sx = nnf[idx * 2],
        sy = nnf[idx * 2 + 1];
      dist[idx] = patchDistance(work, work, width, height, x, y, sx, sy, patchRadius);
    }
  }
}

/**
 * One propagation + random-search pass over the masked pixels.
 *
 * Propagation: each pixel checks the source offsets used by its left/top
 * neighbours (forward pass) or right/bottom neighbours (backward) and
 * adopts them if they yield a lower patch distance.
 *
 * Random search: shrink-around-current-best — try a random candidate in a
 * window of radius R, then R/2, R/4, …, until R < 1.
 */
function patchMatchPass(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  nnf: Int32Array,
  dist: Float64Array,
  searchRegion: Uint8Array | undefined,
  rng: () => number,
  forward: boolean,
  maxRadius: number,
): void {
  const yStart = forward ? 0 : height - 1;
  const yEnd = forward ? height : -1;
  const yStep = forward ? 1 : -1;
  const xStart = forward ? 0 : width - 1;
  const xEnd = forward ? width : -1;
  const xStep = forward ? 1 : -1;
  const off = forward ? -1 : 1; // neighbour offset in scan direction

  for (let y = yStart; y !== yEnd; y += yStep) {
    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      if (!fits(x, y, width, height, patchRadius)) continue;

      let bestSx = nnf[idx * 2];
      let bestSy = nnf[idx * 2 + 1];
      let bestD = dist[idx];

      // ── Propagation from horizontal neighbour ──
      const nx = x + off;
      if (nx >= 0 && nx < width) {
        const nidx = y * width + nx;
        const candX = nnf[nidx * 2] - off;
        const candY = nnf[nidx * 2 + 1];
        if (isValidSource(candX, candY, width, height, mask, patchRadius, searchRegion)) {
          const d = patchDistance(work, work, width, height, x, y, candX, candY, patchRadius);
          if (d < bestD) {
            bestD = d;
            bestSx = candX;
            bestSy = candY;
          }
        }
      }
      // ── Propagation from vertical neighbour ──
      const ny = y + off;
      if (ny >= 0 && ny < height) {
        const nidx = ny * width + x;
        const candX = nnf[nidx * 2];
        const candY = nnf[nidx * 2 + 1] - off;
        if (isValidSource(candX, candY, width, height, mask, patchRadius, searchRegion)) {
          const d = patchDistance(work, work, width, height, x, y, candX, candY, patchRadius);
          if (d < bestD) {
            bestD = d;
            bestSx = candX;
            bestSy = candY;
          }
        }
      }

      // ── Random search around current best ──
      let radius = maxRadius;
      while (radius >= 1) {
        const candX = Math.round(bestSx + (rng() * 2 - 1) * radius);
        const candY = Math.round(bestSy + (rng() * 2 - 1) * radius);
        if (isValidSource(candX, candY, width, height, mask, patchRadius, searchRegion)) {
          const d = patchDistance(work, work, width, height, x, y, candX, candY, patchRadius);
          if (d < bestD) {
            bestD = d;
            bestSx = candX;
            bestSy = candY;
          }
        }
        radius = Math.floor(radius / 2);
      }

      nnf[idx * 2] = bestSx;
      nnf[idx * 2 + 1] = bestSy;
      dist[idx] = bestD;
    }
  }
}

function isValidSource(
  x: number,
  y: number,
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  searchRegion: Uint8Array | undefined,
): boolean {
  if (!fits(x, y, width, height, patchRadius)) return false;
  const idx = y * width + x;
  if (mask[idx]) return false;
  if (searchRegion && !searchRegion[idx]) return false;
  return true;
}

/**
 * Voting reconstruction: for each masked pixel, gather contributions from
 * all patches that overlap it via the current NNF, and rebuild that pixel
 * as the (equal-weighted) mean of those contributions.
 */
function voteReconstruct(
  src: Uint8ClampedArray,
  work: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  patchRadius: number,
  nnf: Int32Array,
): void {
  const size = width * height;
  const accR = new Float64Array(size);
  const accG = new Float64Array(size);
  const accB = new Float64Array(size);
  const accN = new Uint32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      if (!fits(x, y, width, height, patchRadius)) continue;
      const sx = nnf[idx * 2];
      const sy = nnf[idx * 2 + 1];
      // Each NNF entry implies that the target patch at (x,y) should look
      // like the source patch at (sx,sy). Accumulate every offset so the
      // contribution averages over all overlapping source patches.
      for (let dy = -patchRadius; dy <= patchRadius; dy++) {
        for (let dx = -patchRadius; dx <= patchRadius; dx++) {
          const tx = x + dx,
            ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const tIdx = ty * width + tx;
          if (!mask[tIdx]) continue; // only write masked pixels
          const sIdx = ((sy + dy) * width + (sx + dx)) * 4;
          accR[tIdx] += src[sIdx];
          accG[tIdx] += src[sIdx + 1];
          accB[tIdx] += src[sIdx + 2];
          accN[tIdx] += 1;
        }
      }
    }
  }

  for (let i = 0; i < size; i++) {
    if (!mask[i]) continue;
    if (accN[i] === 0) continue;
    const p = i * 4;
    work[p] = Math.round(accR[i] / accN[i]);
    work[p + 1] = Math.round(accG[i] / accN[i]);
    work[p + 2] = Math.round(accB[i] / accN[i]);
    work[p + 3] = 255;
  }
}
