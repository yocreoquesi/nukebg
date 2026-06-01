import { CV_PARAMS } from '../../pipeline/constants';
import type { GridResult } from '../../types/pipeline';
import { median } from './utils';

/**
 * Detect checkerboard grid size and phase from the image edges.
 * Port of Python detect_checker_grid().
 */
export function detectCheckerGrid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colorDark: number[],
  colorLight: number[],
): GridResult {
  const midBrightness =
    ((colorDark[0] + colorDark[1] + colorDark[2]) / 3 +
      (colorLight[0] + colorLight[1] + colorLight[2]) / 3) /
    2;

  const gridSizes: number[] = [];

  const rowsToScan = Math.min(5, height);
  for (let rowIdx = 0; rowIdx < rowsToScan; rowIdx++) {
    const transitions: number[] = [];
    let prevAbove = false;

    for (let x = 0; x < width; x++) {
      const idx = (rowIdx * width + x) * 4;
      const b = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
      const above = b > midBrightness;

      if (x > 0 && above !== prevAbove) {
        transitions.push(x);
      }
      prevAbove = above;
    }

    if (transitions.length >= 4) {
      const gaps: number[] = [];
      for (let i = 1; i < transitions.length; i++) {
        const gap = transitions[i] - transitions[i - 1];
        if (gap > 5) {
          gaps.push(gap);
        }
      }
      if (gaps.length >= 2) {
        gridSizes.push(Math.round(median(gaps)));
      }
    }
  }

  if (gridSizes.length === 0) {
    return { gridSize: 0, phase: 0 };
  }

  const gridSize = Math.round(median(gridSizes));
  if (gridSize < CV_PARAMS.MIN_GRID_SIZE) {
    return { gridSize: 0, phase: 0 };
  }

  // Determine phase
  const centerY = Math.floor(gridSize / 2);
  const centerX = Math.floor(gridSize / 2);
  let phase = 0;

  if (centerY < height && centerX < width) {
    const idx = (centerY * width + centerX) * 4;
    const sampleB = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
    phase = sampleB < midBrightness ? 0 : 1;
  }

  return { gridSize, phase };
}
