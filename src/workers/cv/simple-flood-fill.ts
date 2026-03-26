import { CV_PARAMS } from '../../pipeline/constants';
import { RingBuffer, maxChannelDiff, pixelIndex } from './utils';

/**
 * Simple flood-fill from edges matching either background color.
 * Port of Python flood_fill_background().
 */
export function simpleFloodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorA: number[],
  colorB: number[],
  tolerance: number = CV_PARAMS.COLOR_TOLERANCE
): Uint8Array {
  const totalPixels = width * height;

  // Pre-compute which pixels match bg
  const matchesBg = new Uint8Array(totalPixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = pixelIndex(x, y, width);
      const diffA = maxChannelDiff(pixels, idx, colorA);
      const diffB = maxChannelDiff(pixels, idx, colorB);
      if (diffA <= tolerance || diffB <= tolerance) {
        matchesBg[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(totalPixels);
  const isBg = new Uint8Array(totalPixels);
  const queue = new RingBuffer(Math.min(totalPixels, 1024 * 1024));

  // Seed from edges
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const pos = y * width + x;
      if (matchesBg[pos] && !visited[pos]) {
        visited[pos] = 1;
        isBg[pos] = 1;
        queue.push(y, x);
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const pos = y * width + x;
      if (matchesBg[pos] && !visited[pos]) {
        visited[pos] = 1;
        isBg[pos] = 1;
        queue.push(y, x);
      }
    }
  }

  // BFS
  const dx = [0, 0, -1, 1];
  const dy = [-1, 1, 0, 0];

  while (!queue.empty) {
    const [y, x] = queue.pop();
    for (let d = 0; d < 4; d++) {
      const ny = y + dy[d];
      const nx = x + dx[d];
      if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
        const npos = ny * width + nx;
        if (!visited[npos]) {
          visited[npos] = 1;
          if (matchesBg[npos]) {
            isBg[npos] = 1;
            queue.push(ny, nx);
          }
        }
      }
    }
  }

  return isBg;
}
