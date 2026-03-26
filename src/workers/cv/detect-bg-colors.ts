import { CV_PARAMS } from '../../pipeline/constants';
import type { BgColorResult } from '../../types/pipeline';
import { mean, std, median } from './utils';

/**
 * Detect background color(s) from the image corners.
 * Port of Python detect_bg_colors().
 */
export function detectBgColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sampleSize: number = CV_PARAMS.CORNER_SAMPLE_SIZE
): BgColorResult {
  const s = Math.min(sampleSize, Math.floor(height / 4), Math.floor(width / 4));

  // Collect corner pixels' RGB and brightness
  const allR: number[] = [];
  const allG: number[] = [];
  const allB: number[] = [];
  const brightness: number[] = [];

  // Corners: top-left, top-right, bottom-left, bottom-right
  const corners: [number, number, number, number][] = [
    [0, 0, s, s],
    [0, width - s, s, width],
    [height - s, 0, height, s],
    [height - s, width - s, height, width],
  ];

  for (const [y0, x0, y1, x1] of corners) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        allR.push(r);
        allG.push(g);
        allB.push(b);
        brightness.push((r + g + b) / 3);
      }
    }
  }

  const bStd = std(brightness);

  if (bStd < CV_PARAMS.CHECKER_BRIGHTNESS_STD) {
    // Solid background
    const avgR = Math.round(mean(allR));
    const avgG = Math.round(mean(allG));
    const avgB = Math.round(mean(allB));
    return {
      colorA: [avgR, avgG, avgB],
      colorB: [avgR, avgG, avgB],
      isCheckerboard: false,
      cornerVariance: bStd,
    };
  }

  // Checkerboard: split into dark and light clusters
  const medianB = median(brightness);
  const darkR: number[] = [];
  const darkG: number[] = [];
  const darkB: number[] = [];
  const lightR: number[] = [];
  const lightG: number[] = [];
  const lightB: number[] = [];

  for (let i = 0; i < brightness.length; i++) {
    if (brightness[i] <= medianB) {
      darkR.push(allR[i]);
      darkG.push(allG[i]);
      darkB.push(allB[i]);
    } else {
      lightR.push(allR[i]);
      lightG.push(allG[i]);
      lightB.push(allB[i]);
    }
  }

  return {
    colorA: [Math.round(mean(darkR)), Math.round(mean(darkG)), Math.round(mean(darkB))],
    colorB: [Math.round(mean(lightR)), Math.round(mean(lightG)), Math.round(mean(lightB))],
    isCheckerboard: true,
    cornerVariance: bStd,
  };
}
