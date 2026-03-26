import { WATERMARK_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';
import { pixelIndex } from './utils';

/**
 * Detect the Gemini sparkle watermark in the bottom-right corner.
 * Port of Python detect_gemini_watermark().
 */
export function watermarkDetect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorA: number[],
  colorB: number[]
): WatermarkResult {
  let scanSize = Math.max(
    WATERMARK_PARAMS.MIN_SCAN_SIZE,
    Math.floor(Math.min(height, width) / WATERMARK_PARAMS.SCAN_FRACTION)
  );
  scanSize = Math.min(scanSize, Math.floor(Math.min(height, width) / 2));

  // Compute deviation in bottom-right corner
  const sparkleCoords: [number, number][] = [];

  for (const threshold of WATERMARK_PARAMS.THRESHOLD_CASCADE) {
    sparkleCoords.length = 0;

    for (let ly = 0; ly < scanSize; ly++) {
      const y = height - scanSize + ly;
      for (let lx = 0; lx < scanSize; lx++) {
        const x = width - scanSize + lx;
        const idx = pixelIndex(x, y, width);
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        const diffA = Math.max(
          Math.abs(r - colorA[0]),
          Math.abs(g - colorA[1]),
          Math.abs(b - colorA[2])
        );
        const diffB = Math.max(
          Math.abs(r - colorB[0]),
          Math.abs(g - colorB[1]),
          Math.abs(b - colorB[2])
        );
        const deviation = Math.min(diffA, diffB);

        if (deviation > threshold) {
          sparkleCoords.push([ly, lx]);
        }
      }
    }

    if (sparkleCoords.length >= WATERMARK_PARAMS.MIN_SPARKLE_PIXELS) {
      break;
    }
  }

  if (sparkleCoords.length < WATERMARK_PARAMS.MIN_SPARKLE_PIXELS) {
    return { detected: false, mask: null };
  }

  // Too many deviant pixels means it's the subject, not a watermark
  const scanArea = scanSize * scanSize;
  if (sparkleCoords.length > scanArea * WATERMARK_PARAMS.MAX_SPARKLE_RATIO) {
    return { detected: false, mask: null };
  }

  // Compute center
  let sumY = 0, sumX = 0;
  for (const [ly, lx] of sparkleCoords) {
    sumY += ly;
    sumX += lx;
  }
  const cyLocal = Math.round(sumY / sparkleCoords.length);
  const cxLocal = Math.round(sumX / sparkleCoords.length);

  // Check that sparkle pixels are clustered (not scattered noise)
  const distances: number[] = [];
  for (const [ly, lx] of sparkleCoords) {
    distances.push(Math.sqrt((ly - cyLocal) ** 2 + (lx - cxLocal) ** 2));
  }
  distances.sort((a, b) => a - b);
  const medianDist = distances[Math.floor(distances.length / 2)];

  if (medianDist > scanSize * WATERMARK_PARAMS.MAX_MEDIAN_DISTANCE_RATIO) {
    return { detected: false, mask: null };
  }

  const cyAbs = height - scanSize + cyLocal;
  const cxAbs = width - scanSize + cxLocal;

  // Compute spread and radius
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [ly, lx] of sparkleCoords) {
    minY = Math.min(minY, ly);
    maxY = Math.max(maxY, ly);
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
  }
  const radius = Math.floor(Math.max(maxY - minY, maxX - minX) / 2) + 10;

  // Build circular mask with halo
  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.sqrt((y - cyAbs) ** 2 + (x - cxAbs) ** 2);

      if (dist <= radius * WATERMARK_PARAMS.MASK_RADIUS_MULTIPLIER) {
        mask[y * width + x] = 1;
      } else if (dist <= radius * WATERMARK_PARAMS.HALO_RADIUS_MULTIPLIER) {
        // Check for halo anomaly
        const idx = pixelIndex(x, y, width);
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const diffA = Math.max(
          Math.abs(r - colorA[0]),
          Math.abs(g - colorA[1]),
          Math.abs(b - colorA[2])
        );
        const diffB = Math.max(
          Math.abs(r - colorB[0]),
          Math.abs(g - colorB[1]),
          Math.abs(b - colorB[2])
        );
        const dev = Math.min(diffA, diffB);
        if (dev > WATERMARK_PARAMS.HALO_DEVIATION_THRESHOLD) {
          mask[y * width + x] = 1;
        }
      }
    }
  }

  return {
    detected: true,
    mask,
    centerX: cxAbs,
    centerY: cyAbs,
    radius,
  };
}
