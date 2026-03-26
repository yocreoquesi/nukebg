import { CV_PARAMS } from '../../pipeline/constants';
import { pixelIndex, RingBuffer } from './utils';

/**
 * Find the subject by detecting its colored core and expanding to include
 * the outline. Used as fallback when flood-fill gives low coverage
 * (e.g., dark checkerboard with dark subject outlines).
 *
 * Strategy:
 * 1. Identify "colored" pixels (high saturation + brightness) → subject body
 * 2. Find the largest connected blob → main subject
 * 3. Dilate to include the outline border
 * 4. Erode back slightly to tighten fuzzy edges
 * 5. Everything outside = background
 */
export function subjectExclusion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  _colorDark: number[],
  _colorLight: number[],
  _gridSize: number,
  _phase: number,
  _tolerance: number = CV_PARAMS.COLOR_TOLERANCE
): Uint8Array {
  const totalPixels = width * height;

  // Step 1: Find colored pixels (subject body, not outlines or checker)
  const colored = new Uint8Array(totalPixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = pixelIndex(x, y, width);
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const brightness = (r + g + b) / 3;

      if (sat > CV_PARAMS.CELL_SATURATION_THRESHOLD && brightness > CV_PARAMS.CELL_BRIGHTNESS_THRESHOLD) {
        colored[y * width + x] = 1;
      }
    }
  }

  // Step 2: Find the largest connected blob of colored pixels
  const labeled = new Int32Array(totalPixels);
  let bestLabel = 0;
  let bestSize = 0;
  let labelId = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = y * width + x;
      if (colored[pi] && labeled[pi] === 0) {
        labelId++;
        let count = 0;
        const queue = new RingBuffer(Math.min(totalPixels, 65536));
        queue.push(y, x);
        labeled[pi] = labelId;

        while (!queue.empty) {
          const [cy, cx] = queue.pop();
          count++;

          for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const ni = ny * width + nx;
              if (colored[ni] && labeled[ni] === 0) {
                labeled[ni] = labelId;
                queue.push(ny, nx);
              }
            }
          }
        }

        if (count > bestSize) {
          bestSize = count;
          bestLabel = labelId;
        }
      }
    }
  }

  if (bestLabel === 0) {
    // No colored blob found — mark everything as background
    return new Uint8Array(totalPixels).fill(1);
  }

  // Step 3: Build core mask from the largest blob
  const core = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    core[i] = labeled[i] === bestLabel ? 1 : 0;
  }

  // Step 4: Morphological dilation (8 rounds of 3x3 max filter)
  // This expands the subject body to include the outline (~2-6px wide)
  const DILATE_ROUNDS = 8;
  const ERODE_ROUNDS = 3;

  let mask = core;
  for (let round = 0; round < DILATE_ROUNDS; round++) {
    const next = new Uint8Array(totalPixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          // Set this pixel and all 8 neighbors
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy;
              const nx = x + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                next[ny * width + nx] = 1;
              }
            }
          }
        }
      }
    }
    mask = next;
  }

  // Step 5: Morphological erosion (3 rounds) to tighten back fuzzy edges
  for (let round = 0; round < ERODE_ROUNDS; round++) {
    const next = new Uint8Array(totalPixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        // Keep pixel only if ALL 4-connected neighbors are also set
        let allSet = true;
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            if (!mask[ny * width + nx]) {
              allSet = false;
              break;
            }
          }
        }
        if (allSet) next[y * width + x] = 1;
      }
    }
    mask = next;
  }

  // Step 6: Invert — mask=1 means subject, we need mask=1 means background
  const isBg = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    isBg[i] = mask[i] ? 0 : 1;
  }

  return isBg;
}
