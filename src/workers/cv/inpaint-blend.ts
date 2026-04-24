/**
 * Post-processing for Telea-inpainted regions.
 *
 * Telea FMM reconstructs the masked zone by propagating neighbor colors
 * inward. The output is geometrically correct but visually flat: no film
 * grain, and a hard seam where the mask boundary sits. This module softens
 * the result with two tricks:
 *
 *   1. Feathered compositing — dilate the mask by featherRadius, inpaint
 *      over the dilated region, then blend inpainted → original along a
 *      smooth alpha ramp that peaks inside the core and fades to 0 at the
 *      dilated edge.
 *
 *   2. Noise injection — add Gaussian noise (std = noiseSigma) to each
 *      masked pixel, restoring the micro-texture (film grain, sensor noise)
 *      the inpaint step erased.
 *
 * Kept as a pure, standalone function so the inpaint worker stays
 * testable and the orchestrator can wire it independently.
 */

export interface FeatherOptions {
  /** Pixels of soft transition from inpainted to original. */
  featherRadius: number;
  /** Std-dev of per-channel additive Gaussian noise inside the core mask.
   *  0 disables noise injection. */
  noiseSigma: number;
}

/** Morphological dilation via Chebyshev ball (square SE). Returns a new mask. */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  // Two-pass separable dilation with 1-px SE, applied `radius` times.
  // Simple and fast for small radii (3-6 px) used in practice.
  const src = new Uint8Array(mask);
  const dst = new Uint8Array(mask.length);
  for (let pass = 0; pass < radius; pass++) {
    // Horizontal pass
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        let v = src[i];
        if (x > 0 && src[i - 1]) v = 1;
        if (x < width - 1 && src[i + 1]) v = 1;
        dst[i] = v;
      }
    }
    // Vertical pass (read dst, write back to src)
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        let v = dst[i];
        if (y > 0 && dst[i - width]) v = 1;
        if (y < height - 1 && dst[i + width]) v = 1;
        src[i] = v;
      }
    }
  }
  return src;
}

/** Box-2-sample Gaussian via Box-Muller. Returns one standard-normal sample. */
function gauss(): number {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Composite the inpainted pixels over the original with a feather ring and
 * optional noise injection inside the core mask.
 */
export function compositeWithFeather(
  original: Uint8ClampedArray,
  inpainted: Uint8ClampedArray,
  coreMask: Uint8Array,
  width: number,
  height: number,
  opts: FeatherOptions,
): Uint8ClampedArray {
  const { featherRadius, noiseSigma } = opts;
  const out = new Uint8ClampedArray(original.length);
  out.set(original);

  // Compute per-pixel alpha (0-255):
  //   - 255 inside the core mask
  //   - linear ramp from 255 at core edge to 0 at dilated edge
  //   - 0 outside the dilated mask
  //
  // Implementation: iteratively dilate the core, recording for each pixel
  // the dilation step at which it got set. The alpha is
  //   alpha = 255 * (1 - step / (featherRadius + 1))
  const alphaMap = new Uint8ClampedArray(width * height);
  for (let i = 0; i < coreMask.length; i++) {
    if (coreMask[i]) alphaMap[i] = 255;
  }
  if (featherRadius > 0) {
    const current = new Uint8Array(coreMask);
    const next = new Uint8Array(coreMask.length);
    for (let step = 1; step <= featherRadius; step++) {
      next.set(current);
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const i = row + x;
          if (current[i]) continue;
          const hit =
            (x > 0 && current[i - 1]) ||
            (x < width - 1 && current[i + 1]) ||
            (y > 0 && current[i - width]) ||
            (y < height - 1 && current[i + width]);
          if (hit) {
            next[i] = 1;
            // Linear falloff: step=1 → highest, step=featherRadius → lowest
            alphaMap[i] = Math.round(255 * (1 - step / (featherRadius + 1)));
          }
        }
      }
      current.set(next);
    }
  }

  // Composite with alpha + noise inside the core.
  for (let i = 0, p = 0; i < alphaMap.length; i++, p += 4) {
    const a = alphaMap[i];
    if (a === 0) continue; // unchanged from original

    let ir = inpainted[p];
    let ig = inpainted[p + 1];
    let ib = inpainted[p + 2];

    if (noiseSigma > 0 && coreMask[i]) {
      ir = ir + gauss() * noiseSigma;
      ig = ig + gauss() * noiseSigma;
      ib = ib + gauss() * noiseSigma;
    }

    const inv = 255 - a;
    out[p] = (ir * a + original[p] * inv) / 255;
    out[p + 1] = (ig * a + original[p + 1] * inv) / 255;
    out[p + 2] = (ib * a + original[p + 2] * inv) / 255;
    // Alpha channel: always 255 (opaque). Inpaint output may have garbage
    // here; the original is guaranteed opaque for loaded images.
    out[p + 3] = 255;
  }

  return out;
}
