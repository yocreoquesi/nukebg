/**
 * Alpha matting refinement via guided filter + joint bilateral upsampling.
 *
 * guidedFilter: O(1) box-filter approach that refines the raw alpha mask
 * using the original image as guidance. Eliminates halos and produces
 * smooth edge transitions. He, Sun, Tang (2010/2013).
 *
 * jointBilateralUpsample: Directly upsamples a low-res mask to high-res
 * using the original image as guidance. Each output pixel is a weighted
 * average of nearby low-res samples, with weights driven by spatial
 * distance AND color similarity in the high-res guide. Produces sharp
 * edges at full resolution without intermediate bilinear blur.
 * Kopf et al. (2007) "Joint Bilateral Upsampling".
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

/**
 * Joint Bilateral Upsampling (Kopf et al. 2007).
 *
 * Directly upsamples a low-resolution alpha mask to the high-resolution
 * target using the original high-res image as guidance. Unlike bilinear
 * upscale + guided filter, this avoids the intermediate blurry step —
 * each output pixel is computed directly from low-res neighbours weighted
 * by spatial distance and color similarity in the high-res guide.
 *
 * @param lowAlpha  - Low-res alpha mask (Uint8Array, values 0-255)
 * @param lowW      - Low-res width
 * @param lowH      - Low-res height
 * @param hiPixels  - High-res RGBA pixels (Uint8ClampedArray, the guidance)
 * @param hiW       - High-res width
 * @param hiH       - High-res height
 * @param radius    - Spatial kernel radius in LOW-RES space (default 5)
 * @param sigmaSpatial - Spatial Gaussian sigma in low-res pixels (default 3)
 * @param sigmaRange   - Range Gaussian sigma in 0-255 (default 25)
 * @returns High-res alpha mask (Uint8Array, values 0-255)
 */
export function jointBilateralUpsample(
  lowAlpha: Uint8Array,
  lowW: number,
  lowH: number,
  hiPixels: Uint8ClampedArray,
  hiW: number,
  hiH: number,
  radius: number = 5,
  sigmaSpatial: number = 3.0,
  sigmaRange: number = 25.0,
): Uint8Array {
  if (lowW === hiW && lowH === hiH) return new Uint8Array(lowAlpha);

  const out = new Uint8Array(hiW * hiH);
  const scaleX = lowW / hiW;
  const scaleY = lowH / hiH;

  // Precompute spatial Gaussian LUT — max distance² = (2*radius)²
  const maxDist2 = (2 * radius + 1) * (2 * radius + 1);
  const spatialLUT = new Float32Array(maxDist2 + 1);
  const spatialDenom = -2 * sigmaSpatial * sigmaSpatial;
  for (let d2 = 0; d2 <= maxDist2; d2++) {
    spatialLUT[d2] = Math.exp(d2 / spatialDenom);
  }

  // Precompute range Gaussian LUT — diff is 0..255
  const rangeLUT = new Float32Array(256);
  const rangeDenom = -2 * sigmaRange * sigmaRange;
  for (let d = 0; d < 256; d++) {
    rangeLUT[d] = Math.exp((d * d) / rangeDenom);
  }

  // Precompute high-res luminance (BT.601, integer approximation)
  const hiLum = new Uint8Array(hiW * hiH);
  for (let i = 0; i < hiW * hiH; i++) {
    const off = i * 4;
    hiLum[i] = (77 * hiPixels[off] + 150 * hiPixels[off + 1] + 29 * hiPixels[off + 2]) >> 8;
  }

  // Precompute low-res → high-res coordinate mapping
  const lowToHiX = new Uint32Array(lowW);
  const lowToHiY = new Uint32Array(lowH);
  for (let i = 0; i < lowW; i++) lowToHiX[i] = Math.min(Math.round(i / scaleX), hiW - 1);
  for (let j = 0; j < lowH; j++) lowToHiY[j] = Math.min(Math.round(j / scaleY), hiH - 1);

  for (let y = 0; y < hiH; y++) {
    const ly = y * scaleY;
    const lyCenter = Math.floor(ly);
    const jMin = Math.max(0, lyCenter - radius);
    const jMax = Math.min(lowH - 1, lyCenter + radius);

    for (let x = 0; x < hiW; x++) {
      const lx = x * scaleX;
      const lxCenter = Math.floor(lx);
      const guideLum = hiLum[y * hiW + x];

      let weightSum = 0;
      let valueSum = 0;

      const iMin = Math.max(0, lxCenter - radius);
      const iMax = Math.min(lowW - 1, lxCenter + radius);

      for (let j = jMin; j <= jMax; j++) {
        const dy = j - ly;
        const dy2 = dy * dy;
        const jOff = j * lowW;
        const sampleY = lowToHiY[j];

        for (let i = iMin; i <= iMax; i++) {
          const dx = i - lx;
          // Spatial weight from LUT (use integer key for speed)
          const dist2Key = Math.round(dx * dx + dy2);
          const ws = dist2Key <= maxDist2 ? spatialLUT[dist2Key] : 0;

          // Range weight from LUT
          const sampleLum = hiLum[sampleY * hiW + lowToHiX[i]];
          const wr = rangeLUT[Math.abs(guideLum - sampleLum)];

          const w = ws * wr;
          weightSum += w;
          valueSum += w * lowAlpha[jOff + i];
        }
      }

      out[y * hiW + x] = weightSum > 0
        ? Math.max(0, Math.min(255, Math.round(valueSum / weightSum)))
        : 0;
    }
  }

  return out;
}
