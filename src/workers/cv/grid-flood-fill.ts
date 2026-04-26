import { CV_PARAMS } from '../../pipeline/constants';
import { RingBuffer, maxChannelDiff, pixelIndex } from './utils';

/**
 * Build background mask using grid-aware pixel matching + flood-fill from edges.
 * Port of Python build_grid_aware_bg_mask().
 */
export function gridFloodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorDark: number[],
  colorLight: number[],
  gridSize: number,
  phase: number,
  tolerance: number = CV_PARAMS.COLOR_TOLERANCE,
): Uint8Array {
  const totalPixels = width * height;
  const potentialBg = new Uint8Array(totalPixels);
  const boundaryZone = CV_PARAMS.BOUNDARY_ZONE;

  // Pre-compute potential background for each pixel
  for (let y = 0; y < height; y++) {
    const cellRow = Math.floor(y / gridSize);
    const distByY = Math.min(y % gridSize, gridSize - 1 - (y % gridSize));

    for (let x = 0; x < width; x++) {
      const cellCol = Math.floor(x / gridSize);
      const parity = (cellRow + cellCol + phase) % 2;
      const idx = pixelIndex(x, y, width);

      const diffDark = maxChannelDiff(pixels, idx, colorDark);
      const diffLight = maxChannelDiff(pixels, idx, colorLight);

      // Grid-aware match: pixel matches expected color for its cell
      const gridMatch = parity === 0 ? diffDark <= tolerance : diffLight <= tolerance;

      // Near boundary: accept either color for connectivity
      const distBx = Math.min(x % gridSize, gridSize - 1 - (x % gridSize));
      const nearBoundary = distBx <= boundaryZone || distByY <= boundaryZone;
      const eitherMatch = diffDark <= tolerance || diffLight <= tolerance;

      if (gridMatch || (nearBoundary && eitherMatch)) {
        potentialBg[y * width + x] = 1;
      }
    }
  }

  // Flood-fill from edges through potential_bg
  const visited = new Uint8Array(totalPixels);
  const isBg = new Uint8Array(totalPixels);
  const queue = new RingBuffer(Math.min(totalPixels, 1024 * 1024));

  // Seed from edges
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const pos = y * width + x;
      if (potentialBg[pos] && !visited[pos]) {
        visited[pos] = 1;
        isBg[pos] = 1;
        queue.push(y, x);
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const pos = y * width + x;
      if (potentialBg[pos] && !visited[pos]) {
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
          if (potentialBg[npos]) {
            isBg[npos] = 1;
            queue.push(ny, nx);
          }
        }
      }
    }
  }

  return isBg;
}
