import { describe, it, expect } from 'vitest';
import { watermarkDetectDiagonal } from '../../src/workers/cv/watermark-diagonal';
import { solidImage } from '../helpers';

describe('watermarkDetectDiagonal', () => {
  it('no detecta watermark en imagen limpia con fondo solido', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = watermarkDetectDiagonal(pixels, w, h);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('no detecta watermark en imagen con un solo objeto (no periodico)', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a single rectangle (no periodicity)
    for (let y = 100; y < 200; y++) {
      for (let x = 100; x < 200; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = 50;
        pixels[i + 1] = 50;
        pixels[i + 2] = 50;
      }
    }

    const result = watermarkDetectDiagonal(pixels, w, h);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('detecta patron diagonal periodico simulado', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint repeating diagonal text-like lines across the image
    // Simulate semi-transparent watermark text along 45-degree diagonals
    const period = 60; // pixels between repeating text lines
    const textWidth = 8; // thickness of diagonal text band

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Distance along the perpendicular to the 45-degree diagonal
        const diagDist = (x + y) % period;
        if (diagDist < textWidth) {
          // Semi-transparent watermark (moderate contrast, not full)
          const i = (y * w + x) * 4;
          pixels[i] = 160;     // shifted from 200 bg
          pixels[i + 1] = 160;
          pixels[i + 2] = 160;
        }
      }
    }

    const result = watermarkDetectDiagonal(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();

    if (result.mask) {
      let maskCount = 0;
      for (let i = 0; i < result.mask.length; i++) {
        if (result.mask[i]) maskCount++;
      }
      expect(maskCount).toBeGreaterThan(0);
    }
  });

  it('rechaza patron con contraste demasiado alto (bordes reales)', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint high-contrast diagonal lines (like real edges, not watermarks)
    const period = 60;
    const textWidth = 8;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const diagDist = (x + y) % period;
        if (diagDist < textWidth) {
          const i = (y * w + x) * 4;
          // Full contrast: black on 200-gray background
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        }
      }
    }

    const result = watermarkDetectDiagonal(pixels, w, h);

    // High contrast edges should be rejected by MAX_EDGE_CONTRAST filter
    expect(result.detected).toBe(false);
  });

  it('maneja imagen muy pequena sin crash', () => {
    const w = 20, h = 20;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = watermarkDetectDiagonal(pixels, w, h);

    expect(result).toBeDefined();
    expect(result.detected).toBe(false);
  });

  it('rechaza patron no periodico (random noise)', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Add random noise (not periodic)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.random() < 0.1) {
          const i = (y * w + x) * 4;
          pixels[i] = 160;
          pixels[i + 1] = 160;
          pixels[i + 2] = 160;
        }
      }
    }

    const result = watermarkDetectDiagonal(pixels, w, h);

    // Random noise should not have periodic autocorrelation peaks
    expect(result.detected).toBe(false);
  });

  it('maneja imagen rectangular (no cuadrada)', () => {
    const w = 800, h = 400;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = watermarkDetectDiagonal(pixels, w, h);

    expect(result).toBeDefined();
    expect(result.detected).toBe(false);
  });
});
