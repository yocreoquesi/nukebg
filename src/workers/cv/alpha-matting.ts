/**
 * Alpha matting refinement via guided filter.
 *
 * guidedFilter: O(1) box-filter approach that refines an alpha mask using
 * the original image as guidance. Eliminates halos and snaps edges to the
 * guide's gradient. He, Sun, Tang (2010/2013).
 */

/**
 * Compute box mean via separable sliding window - O(1) per pixel.
 * Two passes: horizontal then vertical, each using a running sum.
 */
function boxMean(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const n = w * h;
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);

  // Horizontal pass: sliding window along each row
  for (let y = 0; y < h; y++) {
    const yOff = y * w;
    let sum = 0;
    // Initialize window [0, radius]
    const initEnd = Math.min(radius, w - 1);
    for (let x = 0; x <= initEnd; x++) sum += src[yOff + x];

    for (let x = 0; x < w; x++) {
      // Expand right edge
      if (x + radius < w && x > 0) sum += src[yOff + x + radius];
      // Shrink left edge
      if (x - radius - 1 >= 0) sum -= src[yOff + x - radius - 1];
      const x0 = Math.max(x - radius, 0);
      const x1 = Math.min(x + radius, w - 1);
      tmp[yOff + x] = sum / (x1 - x0 + 1);
    }
  }

  // Vertical pass: sliding window along each column
  for (let x = 0; x < w; x++) {
    let sum = 0;
    const initEnd = Math.min(radius, h - 1);
    for (let y = 0; y <= initEnd; y++) sum += tmp[y * w + x];

    for (let y = 0; y < h; y++) {
      if (y + radius < h && y > 0) sum += tmp[(y + radius) * w + x];
      if (y - radius - 1 >= 0) sum -= tmp[(y - radius - 1) * w + x];
      const y0 = Math.max(y - radius, 0);
      const y1 = Math.min(y + radius, h - 1);
      out[y * w + x] = sum / (y1 - y0 + 1);
    }
  }

  return out;
}

/**
 * Compute luminance (0..1) from RGBA pixels.
 * Uses standard BT.601 coefficients: 0.299R + 0.587G + 0.114B
 */
function toLuminance(pixels: Uint8ClampedArray, w: number, h: number): Float32Array {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    lum[i] = (0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2]) / 255;
  }
  return lum;
}

/**
 * Element-wise multiply of two Float32Arrays.
 */
function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i];
  return out;
}

/**
 * Apply guided filter to refine an alpha mask using the original image as guidance.
 *
 * @param alpha - Raw alpha mask (Uint8Array, values 0-255)
 * @param pixels - Original RGBA pixels (Uint8ClampedArray)
 * @param w - Image width
 * @param h - Image height
 * @param radius - Filter radius (default 15)
 * @param epsilon - Regularization parameter (default 1e-4)
 * @returns Refined alpha mask (Uint8Array, values 0-255)
 */
export function guidedFilter(
  alpha: Uint8Array,
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number = 15,
  epsilon: number = 1e-4,
): Uint8Array {
  const n = w * h;

  // Convert inputs to float [0, 1]
  const I = toLuminance(pixels, w, h);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = alpha[i] / 255;

  // Step 1: Compute means
  const meanI = boxMean(I, w, h, radius);
  const meanP = boxMean(p, w, h, radius);

  // Step 2: Compute correlation and variance
  const Ip = multiply(I, p);
  const II = multiply(I, I);
  const corrIp = boxMean(Ip, w, h, radius);
  const corrII = boxMean(II, w, h, radius);

  // Step 3: Compute a and b coefficients
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrII[i] - meanI[i] * meanI[i];
    const covIp = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covIp / (varI + epsilon);
    b[i] = meanP[i] - a[i] * meanI[i];
  }

  // Step 4: Compute mean of a and b
  const meanA = boxMean(a, w, h, radius);
  const meanB = boxMean(b, w, h, radius);

  // Step 5: Compute output
  const result = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const val = meanA[i] * I[i] + meanB[i];
    result[i] = Math.max(0, Math.min(255, Math.round(val * 255)));
  }

  return result;
}

