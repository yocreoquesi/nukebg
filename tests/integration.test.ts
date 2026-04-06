import { describe, it, expect } from 'vitest';
import { detectBgColors } from '../src/workers/cv/detect-bg-colors';
import { detectCheckerGrid } from '../src/workers/cv/detect-checker-grid';
import { gridFloodFill } from '../src/workers/cv/grid-flood-fill';
import { simpleFloodFill } from '../src/workers/cv/simple-flood-fill';
import { subjectExclusion } from '../src/workers/cv/subject-exclusion';
import { watermarkDetect } from '../src/workers/cv/watermark-detect';
import { shadowCleanup } from '../src/workers/cv/shadow-cleanup';
import { alphaRefine } from '../src/workers/cv/alpha-refine';
import { CV_PARAMS } from '../src/pipeline/constants';
import { solidImage, checkerboardImage, paintRect } from './helpers';

/**
 * Integration tests: exercise the full CV pipeline without workers,
 * simulating real scenarios from the PRD acceptance tests.
 */

/**
 * Runs the full CV pipeline and returns the alpha channel.
 */
function runCvPipeline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): { alpha: Uint8Array; bgType: string; watermarkRemoved: boolean } {
  // 1. Detect background
  const bgInfo = detectBgColors(pixels, width, height);

  let bgType: string;
  let bgMask: Uint8Array;

  if (bgInfo.isCheckerboard) {
    bgType = 'checkerboard';
    const grid = detectCheckerGrid(pixels, width, height, bgInfo.colorA, bgInfo.colorB);

    if (grid.gridSize > 0) {
      bgMask = gridFloodFill(
        pixels, width, height,
        bgInfo.colorA, bgInfo.colorB,
        grid.gridSize, grid.phase
      );

      let bgCount = 0;
      for (let i = 0; i < bgMask.length; i++) if (bgMask[i]) bgCount++;
      const coverage = bgCount / (width * height);

      if (coverage < CV_PARAMS.LOW_COVERAGE_THRESHOLD) {
        const exclMask = subjectExclusion(
          pixels, width, height,
          bgInfo.colorA, bgInfo.colorB,
          grid.gridSize, grid.phase
        );
        const floodMask = simpleFloodFill(
          pixels, width, height,
          bgInfo.colorA, bgInfo.colorB
        );
        bgMask = new Uint8Array(width * height);
        for (let i = 0; i < bgMask.length; i++) {
          bgMask[i] = exclMask[i] || floodMask[i] ? 1 : 0;
        }
      }
    } else {
      bgMask = simpleFloodFill(
        pixels, width, height,
        bgInfo.colorA, bgInfo.colorB
      );
    }
  } else if (bgInfo.cornerVariance < CV_PARAMS.SOLID_BG_VARIANCE) {
    bgType = 'solid';
    bgMask = simpleFloodFill(
      pixels, width, height,
      bgInfo.colorA, bgInfo.colorB
    );
  } else {
    bgType = 'complex';
    // In test, without ML worker, return empty mask
    bgMask = new Uint8Array(width * height);
  }

  // Watermark
  const wm = watermarkDetect(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  let watermarkRemoved = false;
  if (wm.detected && wm.mask) {
    const newMask = new Uint8Array(width * height);
    for (let i = 0; i < newMask.length; i++) {
      newMask[i] = bgMask[i] || wm.mask[i] ? 1 : 0;
    }
    bgMask = newMask;
    watermarkRemoved = true;
  }

  // Shadow cleanup
  bgMask = shadowCleanup(pixels, width, height, bgMask);

  // Alpha refine
  const alpha = alphaRefine(bgMask, width, height);

  return { alpha, bgType, watermarkRemoved };
}

describe('Integration: T1 - Gemini icon with checkerboard', () => {
  it('removes checkerboard and preserves subject', () => {
    const w = 256, h = 256, gs = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Subject: colorful icon in the center
    paintRect(pixels, w, 80, 80, 96, 96, 220, 50, 50);

    const { alpha, bgType } = runCvPipeline(pixels, w, h);

    expect(bgType).toBe('checkerboard');

    // Subject has high alpha
    const centerAlpha = alpha[128 * w + 128];
    expect(centerAlpha).toBe(255);

    // Corner has alpha 0
    expect(alpha[0]).toBe(0);
    expect(alpha[w - 1]).toBe(0);
  });
});

describe('Integration: T2 - Illustration on white background', () => {
  it('removes solid white background and preserves subject', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 255, 255, 255);
    paintRect(pixels, w, 60, 60, 136, 136, 100, 150, 80);

    const { alpha, bgType } = runCvPipeline(pixels, w, h);

    expect(bgType).toBe('solid');

    // Subject: alpha 255
    expect(alpha[128 * w + 128]).toBe(255);

    // Background: alpha 0
    expect(alpha[0]).toBe(0);
    expect(alpha[(h - 1) * w + (w - 1)]).toBe(0);
  });
});

describe('Integration: T3 - Illustration on black background', () => {
  it('removes solid black background and preserves subject', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 0, 0, 0);
    paintRect(pixels, w, 60, 60, 136, 136, 200, 100, 50);

    const { alpha, bgType } = runCvPipeline(pixels, w, h);

    expect(bgType).toBe('solid');
    expect(alpha[128 * w + 128]).toBe(255);
    expect(alpha[0]).toBe(0);
  });
});

describe('Integration: T5 - Already transparent PNG (passthrough)', () => {
  it('image with alpha 0 in corners is detected as solid and processed', () => {
    // Simulate an image with a uniform background color
    // (in the real world it would be alpha=0, but our pipeline operates on RGB)
    const w = 128, h = 128;
    const pixels = solidImage(w, h, 0, 0, 0);
    paintRect(pixels, w, 30, 30, 68, 68, 150, 200, 100);

    const { alpha, bgType } = runCvPipeline(pixels, w, h);
    expect(bgType).toBe('solid');
    expect(alpha[64 * w + 64]).toBe(255);
  });
});

describe('Integration: performance', () => {
  it('processes 512x512 in less than 2 seconds (no ML)', () => {
    const w = 512, h = 512, gs = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);
    paintRect(pixels, w, 150, 150, 212, 212, 200, 50, 50);

    const start = performance.now();
    const { alpha } = runCvPipeline(pixels, w, h);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
    expect(alpha.length).toBe(w * h);
  });

  it('processes 256x256 solid in less than 500ms', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 255, 255, 255);
    paintRect(pixels, w, 60, 60, 136, 136, 100, 50, 200);

    const start = performance.now();
    const { alpha } = runCvPipeline(pixels, w, h);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(alpha.length).toBe(w * h);
  });
});

describe('Integration: subject with shadows', () => {
  it('cleans gray shadows around the subject', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Colorful subject
    paintRect(pixels, w, 80, 80, 96, 96, 200, 50, 50);

    // Small gray shadow disconnected from subject
    paintRect(pixels, w, 20, 20, 10, 10, 60, 60, 60);

    const { alpha } = runCvPipeline(pixels, w, h);

    // The shadow should have alpha 0 (removed)
    expect(alpha[25 * w + 25]).toBe(0);

    // The subject should have alpha 255
    expect(alpha[128 * w + 128]).toBe(255);
  });
});
