import { IMAGE_CLASSIFY_PARAMS } from '../../pipeline/constants';

/**
 * Signature threshold: extract signature strokes from a mostly-white background
 * using adaptive thresholding techniques.
 *
 * Returns an alpha mask (Uint8Array) where:
 *   0 = background (transparent)
 *   255 = foreground (opaque ink)
 *   1-254 = anti-aliased transition zone
 */
export function signatureThreshold(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const P = IMAGE_CLASSIFY_PARAMS;
  const totalPixels = width * height;
  const alpha = new Uint8Array(totalPixels);

  // Convert to grayscale
  const gray = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    gray[i] = 0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2];
  }

  // Decide between Otsu (small images / uniform bg) and Sauvola (large / irregular bg)
  const useOtsu = width < P.SAUVOLA_MIN_SIZE || height < P.SAUVOLA_MIN_SIZE;

  let thresholdMap: Float32Array;

  if (useOtsu) {
    // Global Otsu threshold
    const otsuT = computeOtsu(gray);
    thresholdMap = new Float32Array(totalPixels);
    thresholdMap.fill(otsuT);
  } else {
    // Sauvola adaptive threshold
    thresholdMap = computeSauvola(gray, width, height, P.SAUVOLA_WINDOW, P.SAUVOLA_K);
  }

  // Apply threshold with anti-aliasing transition band
  const halfBand = P.AA_BAND_SIZE / 2;
  for (let i = 0; i < totalPixels; i++) {
    const t = thresholdMap[i];
    const g = gray[i];
    const diff = t - g; // positive = pixel is darker than threshold = foreground

    if (diff > halfBand) {
      alpha[i] = 255; // solid foreground
    } else if (diff < -halfBand) {
      alpha[i] = 0; // solid background
    } else {
      // Anti-aliased transition: linear interpolation across the band
      alpha[i] = Math.round(255 * (diff + halfBand) / P.AA_BAND_SIZE);
    }
  }

  // Morphological close (dilate then erode) to fill gaps in strokes
  morphologicalClose(alpha, width, height, P.MORPH_RADIUS);

  return alpha;
}

/**
 * Compute Otsu's optimal threshold for bimodal histogram separation.
 * Minimizes intra-class variance between background and foreground.
 */
export function computeOtsu(gray: Float32Array): number {
  const histogram = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) {
    histogram[Math.round(Math.min(255, Math.max(0, gray[i])))]++;
  }

  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    sumAll += i * histogram[i];
  }

  let sumBg = 0;
  let weightBg = 0;
  let maxVariance = 0;
  let firstBest = 0;
  let lastBest = 0;

  for (let t = 0; t < 256; t++) {
    weightBg += histogram[t];
    if (weightBg === 0) continue;

    const weightFg = total - weightBg;
    if (weightFg === 0) break;

    sumBg += t * histogram[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const meanDiff = meanBg - meanFg;
    const variance = weightBg * weightFg * meanDiff * meanDiff;

    if (variance > maxVariance) {
      maxVariance = variance;
      firstBest = t;
      lastBest = t;
    } else if (variance === maxVariance) {
      lastBest = t;
    }
  }

  // Use midpoint of the range of equally-optimal thresholds
  // This gives more natural results for bimodal distributions
  return Math.round((firstBest + lastBest) / 2);
}

/**
 * Sauvola adaptive thresholding.
 * T(x,y) = mean(x,y) * (1 + k * (std(x,y) / R - 1))
 * where R = 128 (dynamic range of standard deviation).
 *
 * Uses integral images for O(1) per-pixel local mean and std computation.
 */
function computeSauvola(
  gray: Float32Array,
  width: number,
  height: number,
  windowSize: number,
  k: number,
): Float32Array {
  const R = 128; // dynamic range
  const halfWin = Math.floor(windowSize / 2);

  // Build integral images for sum and sum of squares
  const integralSum = new Float64Array((width + 1) * (height + 1));
  const integralSqSum = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSqSum = 0;
    for (let x = 0; x < width; x++) {
      const g = gray[y * width + x];
      rowSum += g;
      rowSqSum += g * g;
      const idx = (y + 1) * (width + 1) + (x + 1);
      integralSum[idx] = rowSum + integralSum[y * (width + 1) + (x + 1)];
      integralSqSum[idx] = rowSqSum + integralSqSum[y * (width + 1) + (x + 1)];
    }
  }

  const thresholdMap = new Float32Array(width * height);
  const stride = width + 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const y1 = Math.max(0, y - halfWin);
      const y2 = Math.min(height - 1, y + halfWin);
      const x1 = Math.max(0, x - halfWin);
      const x2 = Math.min(width - 1, x + halfWin);

      const count = (y2 - y1 + 1) * (x2 - x1 + 1);

      // Sum in rectangle using integral image
      const sum =
        integralSum[(y2 + 1) * stride + (x2 + 1)] -
        integralSum[y1 * stride + (x2 + 1)] -
        integralSum[(y2 + 1) * stride + x1] +
        integralSum[y1 * stride + x1];

      const sqSum =
        integralSqSum[(y2 + 1) * stride + (x2 + 1)] -
        integralSqSum[y1 * stride + (x2 + 1)] -
        integralSqSum[(y2 + 1) * stride + x1] +
        integralSqSum[y1 * stride + x1];

      const localMean = sum / count;
      const localVariance = sqSum / count - localMean * localMean;
      const localStd = Math.sqrt(Math.max(0, localVariance));

      thresholdMap[y * width + x] = localMean * (1 + k * (localStd / R - 1));
    }
  }

  return thresholdMap;
}

/**
 * Morphological close: dilate then erode.
 * Closes small gaps in strokes (e.g., broken pen lines in scanned signatures).
 * Operates on alpha values: treats any value > 0 as foreground during structuring.
 */
export function morphologicalClose(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number,
): void {
  const totalPixels = width * height;
  const temp = new Uint8Array(totalPixels);

  // Dilate: if any neighbor in radius is foreground, pixel becomes foreground
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const val = alpha[ny * width + nx];
          if (val > maxVal) maxVal = val;
        }
      }
      temp[y * width + x] = maxVal;
    }
  }

  // Erode: if any neighbor in radius is background, pixel becomes background
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const val = temp[ny * width + nx];
          if (val < minVal) minVal = val;
        }
      }
      alpha[y * width + x] = minVal;
    }
  }
}
