import { DIAGONAL_WATERMARK_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';

/**
 * Detect diagonal repeating text watermarks (Shutterstock, Getty, iStock,
 * Adobe Stock, Alamy, Dreamstime, 123RF).
 *
 * Algorithm:
 * 1. Downsample 2x for performance
 * 2. Convert to grayscale
 * 3. Compute Sobel gradient magnitude
 * 4. Project gradient along diagonal strips at ~45 degrees
 * 5. Detect periodicity via autocorrelation
 * 6. Build mask on detected periodic diagonal bands
 * 7. False positive defenses (coverage, contrast, peak count, regularity)
 */
export function watermarkDetectDiagonal(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkResult {
  const {
    DOWNSAMPLE_FACTOR,
    SOBEL_THRESHOLD,
    NUM_STRIPS,
    MIN_PERIODICITY_PEAKS,
    MIN_IMAGE_COVERAGE,
    MAX_EDGE_CONTRAST,
    AUTOCORR_PEAK_THRESHOLD,
    PEAK_SPACING_CV_MAX,
    MASK_DILATE_RADIUS,
  } = DIAGONAL_WATERMARK_PARAMS;

  // Step 1: Downsample
  const dw = Math.floor(width / DOWNSAMPLE_FACTOR);
  const dh = Math.floor(height / DOWNSAMPLE_FACTOR);

  if (dw < 2 || dh < 2) {
    return { detected: false, mask: null };
  }

  // Step 2: Grayscale on downsampled image
  const gray = new Float32Array(dw * dh);
  for (let dy = 0; dy < dh; dy++) {
    const srcY = dy * DOWNSAMPLE_FACTOR;
    for (let dx = 0; dx < dw; dx++) {
      const srcX = dx * DOWNSAMPLE_FACTOR;
      const srcIdx = (srcY * width + srcX) * 4;
      gray[dy * dw + dx] = 0.299 * pixels[srcIdx] + 0.587 * pixels[srcIdx + 1] + 0.114 * pixels[srcIdx + 2];
    }
  }

  // Step 3: Sobel gradient magnitude
  const gradient = new Float32Array(dw * dh);
  for (let y = 1; y < dh - 1; y++) {
    for (let x = 1; x < dw - 1; x++) {
      const tl = gray[(y - 1) * dw + (x - 1)];
      const tc = gray[(y - 1) * dw + x];
      const tr = gray[(y - 1) * dw + (x + 1)];
      const ml = gray[y * dw + (x - 1)];
      const mr = gray[y * dw + (x + 1)];
      const bl = gray[(y + 1) * dw + (x - 1)];
      const bc = gray[(y + 1) * dw + x];
      const br = gray[(y + 1) * dw + (x + 1)];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      gradient[y * dw + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Step 4: Project gradient along diagonal strips at ~45 degrees
  // For a 45-degree diagonal, the perpendicular axis is (1,1)/sqrt(2).
  // Each pixel maps to a strip index based on (x + y).
  const diagMax = dw + dh - 2;
  if (diagMax < NUM_STRIPS) {
    return { detected: false, mask: null };
  }

  const stripWidth = diagMax / NUM_STRIPS;
  const stripSums = new Float64Array(NUM_STRIPS);
  const stripCounts = new Float64Array(NUM_STRIPS);

  for (let y = 1; y < dh - 1; y++) {
    for (let x = 1; x < dw - 1; x++) {
      const diagVal = x + y;
      const stripIdx = Math.min(Math.floor(diagVal / stripWidth), NUM_STRIPS - 1);
      stripSums[stripIdx] += gradient[y * dw + x];
      stripCounts[stripIdx] += 1;
    }
  }

  // Normalize strip sums by count to get average gradient per strip
  const stripAvg = new Float64Array(NUM_STRIPS);
  for (let i = 0; i < NUM_STRIPS; i++) {
    stripAvg[i] = stripCounts[i] > 0 ? stripSums[i] / stripCounts[i] : 0;
  }

  // Step 5: Detect periodicity via autocorrelation
  // Subtract mean
  let meanVal = 0;
  for (let i = 0; i < NUM_STRIPS; i++) meanVal += stripAvg[i];
  meanVal /= NUM_STRIPS;

  const centered = new Float64Array(NUM_STRIPS);
  let variance = 0;
  for (let i = 0; i < NUM_STRIPS; i++) {
    centered[i] = stripAvg[i] - meanVal;
    variance += centered[i] * centered[i];
  }

  if (variance < 1e-10) {
    return { detected: false, mask: null };
  }

  // Compute normalized autocorrelation for lags 1..NUM_STRIPS/2
  const maxLag = Math.floor(NUM_STRIPS / 2);
  const autocorr = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < NUM_STRIPS - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
    autocorr[lag] = sum / variance;
  }

  // Find peaks in autocorrelation (lag > 0)
  const peakLags: number[] = [];
  for (let lag = 2; lag < maxLag; lag++) {
    if (
      autocorr[lag] > AUTOCORR_PEAK_THRESHOLD &&
      autocorr[lag] > autocorr[lag - 1] &&
      autocorr[lag] > autocorr[lag + 1]
    ) {
      peakLags.push(lag);
    }
  }

  // Not enough periodic peaks
  if (peakLags.length < MIN_PERIODICITY_PEAKS) {
    return { detected: false, mask: null };
  }

  // Check regularity of peak spacing (coefficient of variation)
  const spacings: number[] = [];
  for (let i = 1; i < peakLags.length; i++) {
    spacings.push(peakLags[i] - peakLags[i - 1]);
  }

  if (spacings.length > 0) {
    let spacingMean = 0;
    for (const s of spacings) spacingMean += s;
    spacingMean /= spacings.length;

    if (spacingMean > 0) {
      let spacingVar = 0;
      for (const s of spacings) {
        const d = s - spacingMean;
        spacingVar += d * d;
      }
      const spacingCV = Math.sqrt(spacingVar / spacings.length) / spacingMean;

      if (spacingCV > PEAK_SPACING_CV_MAX) {
        return { detected: false, mask: null };
      }
    }
  }

  // Step 6: Check edge contrast (must be moderate, not full contrast)
  // Collect gradient values at detected edges
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < dh - 1; y++) {
    for (let x = 1; x < dw - 1; x++) {
      const g = gradient[y * dw + x];
      if (g > SOBEL_THRESHOLD) {
        edgeSum += g;
        edgeCount++;
      }
    }
  }

  if (edgeCount === 0) {
    return { detected: false, mask: null };
  }

  const avgEdgeContrast = edgeSum / edgeCount;
  if (avgEdgeContrast > MAX_EDGE_CONTRAST) {
    return { detected: false, mask: null };
  }

  // Step 7: Build mask at original resolution
  // Determine which diagonal strips are "watermark bands"
  // A strip is a watermark band if its average gradient is above the mean
  const bandThreshold = meanVal;
  const isBand = new Uint8Array(NUM_STRIPS);
  for (let i = 0; i < NUM_STRIPS; i++) {
    isBand[i] = stripAvg[i] > bandThreshold ? 1 : 0;
  }

  // Count band coverage
  let bandPixels = 0;
  for (let i = 0; i < NUM_STRIPS; i++) {
    if (isBand[i]) bandPixels += stripCounts[i];
  }
  const totalInner = (dw - 2) * (dh - 2);
  const coverage = totalInner > 0 ? bandPixels / totalInner : 0;

  if (coverage < MIN_IMAGE_COVERAGE) {
    return { detected: false, mask: null };
  }

  // Build the mask at original resolution
  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);

  // Scale factor from downsampled coordinates to original strip index
  const origDiagMax = (width - 1) + (height - 1);
  const origStripWidth = origDiagMax / NUM_STRIPS;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Check if pixel is in a watermark band
      const diagVal = x + y;
      const stripIdx = Math.min(Math.floor(diagVal / origStripWidth), NUM_STRIPS - 1);

      if (!isBand[stripIdx]) continue;

      // Check gradient at downsampled location
      const dx = Math.min(Math.floor(x / DOWNSAMPLE_FACTOR), dw - 1);
      const dy = Math.min(Math.floor(y / DOWNSAMPLE_FACTOR), dh - 1);
      const g = gradient[dy * dw + dx];

      if (g > SOBEL_THRESHOLD) {
        mask[y * width + x] = 1;
      }
    }
  }

  // Dilate mask
  if (MASK_DILATE_RADIUS > 0) {
    dilateMask(mask, width, height, MASK_DILATE_RADIUS);
  }

  // Verify mask has meaningful coverage
  let maskCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (mask[i]) maskCount++;
  }

  if (maskCount === 0) {
    return { detected: false, mask: null };
  }

  return { detected: true, mask };
}

/**
 * In-place binary dilation of a mask using a square structuring element.
 */
function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): void {
  // Find pixels to dilate onto (cannot modify mask while reading it)
  const toSet: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue; // already set

      // Check if any neighbor within radius is set
      let found = false;
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);

      for (let ny = yMin; ny <= yMax && !found; ny++) {
        for (let nx = xMin; nx <= xMax && !found; nx++) {
          if (mask[ny * width + nx]) {
            found = true;
          }
        }
      }

      if (found) {
        toSet.push(y * width + x);
      }
    }
  }

  for (const idx of toSet) {
    mask[idx] = 1;
  }
}
