import { SHADOW_PARAMS } from '../../pipeline/constants';
import { pixelIndex } from './utils';

/**
 * Remove shadow/smudge blobs - low-saturation islands not connected to subject.
 * Port of Python remove_shadow_artifacts().
 */
export function shadowCleanup(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  maxBlobSize: number = SHADOW_PARAMS.MAX_BLOB_SIZE,
): Uint8Array {
  const result = new Uint8Array(mask);
  const totalPixels = width * height;

  // Find shadow candidates: foreground pixels with low saturation
  const candidate = new Uint8Array(totalPixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (result[pos]) continue; // already background

      const idx = pixelIndex(x, y, width);
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const brightness = (r + g + b) / 3;

      if (
        sat < SHADOW_PARAMS.SATURATION_THRESHOLD &&
        brightness < SHADOW_PARAMS.BRIGHTNESS_MAX &&
        brightness > SHADOW_PARAMS.BRIGHTNESS_MIN
      ) {
        candidate[pos] = 1;
      }
    }
  }

  // Connected component labeling with flood-fill
  const labeled = new Int32Array(totalPixels);
  let labelId = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (candidate[pos] && labeled[pos] === 0) {
        labelId++;
        const blob: number[] = [];
        const stack: [number, number][] = [[y, x]];
        let overflow = false;

        while (stack.length > 0) {
          const [cy, cx] = stack.pop()!;
          if (cy < 0 || cy >= height || cx < 0 || cx >= width) continue;
          const cpos = cy * width + cx;
          if (!candidate[cpos] || labeled[cpos] !== 0) continue;

          labeled[cpos] = labelId;
          if (!overflow) {
            blob.push(cpos);
            if (blob.length > maxBlobSize) {
              overflow = true;
            }
          }
          if (cy > 0) stack.push([cy - 1, cx]);
          if (cy < height - 1) stack.push([cy + 1, cx]);
          if (cx > 0) stack.push([cy, cx - 1]);
          if (cx < width - 1) stack.push([cy, cx + 1]);
        }

        // Mark small blobs as background (they are shadow artifacts)
        if (!overflow && blob.length > 0 && blob.length <= maxBlobSize) {
          for (const bpos of blob) {
            result[bpos] = 1;
          }
        }
      }
    }
  }

  return result;
}
