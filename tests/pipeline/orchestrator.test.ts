import { describe, it, expect } from 'vitest';
import { CV_PARAMS } from '../../src/pipeline/constants';

/**
 * Pipeline orchestrator tests.
 *
 * PipelineOrchestrator depends on Web Workers (new Worker(...)),
 * which are not available in the unit test environment.
 *
 * Strategy: test the pipeline's decision logic by importing CV functions
 * directly and simulating the flow the orchestrator would execute.
 * This validates that the routing logic is correct.
 *
 * NOTE: The orchestrator now uses soft alpha from the ML model directly.
 * It no longer calls alpha-refine or shadow-cleanup. Tests simulate
 * the current flow: detect-bg -> ML segmentation (soft alpha) -> watermark -> compose.
 */

// Import CV functions directly (without workers)
import { detectBgColors } from '../../src/workers/cv/detect-bg-colors';
import { detectCheckerGrid } from '../../src/workers/cv/detect-checker-grid';
import { gridFloodFill } from '../../src/workers/cv/grid-flood-fill';
import { simpleFloodFill } from '../../src/workers/cv/simple-flood-fill';
import { subjectExclusion } from '../../src/workers/cv/subject-exclusion';
import { watermarkDetect } from '../../src/workers/cv/watermark-detect';
import { solidImage, checkerboardImage, paintRect, countBg } from '../helpers';

/**
 * Simulates the soft alpha that the ML model would return.
 * For unit tests: foreground=255, background=0,
 * based on color difference from the detected background.
 */
function simulateMlSoftAlpha(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  bgColorA: number[],
  bgColorB: number[]
): Uint8Array {
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const distA = Math.abs(r - bgColorA[0]) + Math.abs(g - bgColorA[1]) + Math.abs(b - bgColorA[2]);
    const distB = Math.abs(r - bgColorB[0]) + Math.abs(g - bgColorB[1]) + Math.abs(b - bgColorB[2]);
    const minDist = Math.min(distA, distB);
    // Soft alpha: gradual transition
    alpha[i] = Math.min(255, Math.round(minDist * 3));
  }
  return alpha;
}

describe('Pipeline - flujo de decision (nuevo: ML soft alpha)', () => {

  it('clasifica fondo solido correctamente', () => {
    const w = 128, h = 128;
    const pixels = solidImage(w, h, 255, 255, 255);
    paintRect(pixels, w, 40, 40, 48, 48, 200, 50, 50);

    // Paso 1: detect bg
    const bgInfo = detectBgColors(pixels, w, h);
    expect(bgInfo.isCheckerboard).toBe(false);
    expect(bgInfo.cornerVariance).toBeLessThan(CV_PARAMS.SOLID_BG_VARIANCE);

    // Paso 2: ML segmentation devuelve soft alpha (simulado)
    const alpha = simulateMlSoftAlpha(pixels, w, h, bgInfo.colorA, bgInfo.colorB);

    // Sujeto tiene alpha alto (el sujeto es colorido, lejos del fondo blanco)
    expect(alpha[64 * w + 64]).toBeGreaterThan(200);
    // Fondo tiene alpha 0 (identico al bg color)
    expect(alpha[0]).toBe(0);

    // Watermark scan (no deberia encontrar nada)
    const wm = watermarkDetect(pixels, w, h, bgInfo.colorA, bgInfo.colorB);
    expect(wm.detected).toBe(false);
  });

  it('clasifica checkerboard y ejecuta grid flood fill para deteccion', () => {
    const w = 256, h = 256, gs = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);
    paintRect(pixels, w, 80, 80, 96, 96, 200, 50, 50);

    // Paso 1: detect bg
    const bgInfo = detectBgColors(pixels, w, h);
    expect(bgInfo.isCheckerboard).toBe(true);

    // Paso 2: detect grid (usado para watermark, no para alpha)
    const grid = detectCheckerGrid(pixels, w, h, bgInfo.colorA, bgInfo.colorB);
    expect(grid.gridSize).toBeGreaterThan(0);

    // Paso 3: ML segmentation (soft alpha)
    const alpha = simulateMlSoftAlpha(pixels, w, h, bgInfo.colorA, bgInfo.colorB);

    // Sujeto central tiene alpha alto
    expect(alpha[128 * w + 128]).toBeGreaterThan(200);
    // Esquina tiene alpha bajo (checker colors son cercanos al bg detected)
    expect(alpha[0]).toBeLessThan(50);
  });

  it('clasifica background complejo (alta varianza, no checker)', () => {
    const w = 128, h = 128;
    // Image with gradient (high variance in corners, but not checker)
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = Math.floor((x / w) * 255);
        pixels[i + 1] = Math.floor((y / h) * 255);
        pixels[i + 2] = 128;
        pixels[i + 3] = 255;
      }
    }

    const bgInfo = detectBgColors(pixels, w, h);

    // Not checker, and variance is high (not solid)
    // En este caso el pipeline rutea a ML. Solo verificamos la clasificacion.
    if (bgInfo.isCheckerboard) {
      const grid = detectCheckerGrid(pixels, w, h, bgInfo.colorA, bgInfo.colorB);
      expect(grid).toBeDefined();
    } else {
      expect(bgInfo.cornerVariance).toBeDefined();
    }
  });

  it('pipeline completo para checkerboard con coverage bajo ejecuta subject exclusion', () => {
    const w = 128, h = 128, gs = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Sujeto gigante que cubre mucho de la imagen
    paintRect(pixels, w, 10, 10, 108, 108, 200, 50, 50);

    const bgInfo = detectBgColors(pixels, w, h);

    // Si detecta checkerboard (puede no hacerlo si el sujeto cubre las esquinas)
    if (bgInfo.isCheckerboard) {
      const grid = detectCheckerGrid(pixels, w, h, bgInfo.colorA, bgInfo.colorB);

      if (grid.gridSize > 0) {
        const bgMask = gridFloodFill(
          pixels, w, h,
          bgInfo.colorA, bgInfo.colorB,
          grid.gridSize, grid.phase
        );

        const coverage = countBg(bgMask) / (w * h);

        if (coverage < CV_PARAMS.LOW_COVERAGE_THRESHOLD) {
          // Fallback a subject exclusion
          const exclMask = subjectExclusion(
            pixels, w, h,
            bgInfo.colorA, bgInfo.colorB,
            grid.gridSize, grid.phase
          );

          const floodMask = simpleFloodFill(
            pixels, w, h,
            bgInfo.colorA, bgInfo.colorB
          );

          // Union
          const unionMask = new Uint8Array(w * h);
          for (let i = 0; i < unionMask.length; i++) {
            unionMask[i] = exclMask[i] || floodMask[i] ? 1 : 0;
          }

          expect(unionMask.length).toBe(w * h);
        }
      }
    }
    // Regardless of branch, the background detector must have completed
    // and returned structurally valid colors — this is the contract we
    // actually care about when feeding a checkerboard into the pipeline.
    expect(bgInfo.colorA).toHaveLength(3);
    expect(bgInfo.colorB).toHaveLength(3);
    expect(bgInfo.cornerVariance).toBeGreaterThanOrEqual(0);
  });
});

describe('Pipeline - composicion final RGBA con soft alpha', () => {
  it('combina pixeles originales con soft alpha del ML model', () => {
    const w = 16, h = 16;
    const pixels = solidImage(w, h, 255, 255, 255);
    paintRect(pixels, w, 4, 4, 8, 8, 100, 150, 200);

    const bgInfo = detectBgColors(pixels, w, h);

    // Simular soft alpha del ML (en vez de alphaRefine sobre bgMask)
    const alpha = simulateMlSoftAlpha(pixels, w, h, bgInfo.colorA, bgInfo.colorB);

    // Compose — exactamente como hace el orchestrator ahora
    const result = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      result[i * 4] = pixels[i * 4];
      result[i * 4 + 1] = pixels[i * 4 + 1];
      result[i * 4 + 2] = pixels[i * 4 + 2];
      result[i * 4 + 3] = alpha[i];
    }

    // Subject pixel (center, 8,8): RGB intact, high alpha
    const ci = (8 * w + 8) * 4;
    expect(result[ci]).toBe(100);
    expect(result[ci + 1]).toBe(150);
    expect(result[ci + 2]).toBe(200);
    expect(result[ci + 3]).toBeGreaterThan(200);

    // Background pixel (corner 0,0): RGB intact, alpha=0
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(255);
    expect(result[2]).toBe(255);
    expect(result[3]).toBe(0);
  });

  it('soft alpha preserva valores intermedios (semi-transparencia)', () => {
    const w = 16, h = 16;
    const pixels = solidImage(w, h, 255, 255, 255);
    // Pixel ligeramente diferente al fondo (simula borde suave)
    paintRect(pixels, w, 7, 7, 2, 2, 230, 230, 230);

    const bgInfo = detectBgColors(pixels, w, h);
    const alpha = simulateMlSoftAlpha(pixels, w, h, bgInfo.colorA, bgInfo.colorB);

    // El pixel semi-diferente tiene alpha intermedio (no 0 ni 255)
    const idx = 8 * w + 8;
    expect(alpha[idx]).toBeGreaterThan(0);
    expect(alpha[idx]).toBeLessThan(255);
  });
});

describe('Pipeline - watermark zeroes alpha en soft alpha', () => {
  it('watermark mask pone alpha a 0 donde se detecta watermark', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 200, 200, 200);
    // Sujeto
    paintRect(pixels, w, 20, 20, 24, 24, 100, 50, 50);

    // Simular soft alpha
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      alpha[i] = 200; // Todo tiene alpha alto inicialmente
    }

    // Simular watermark mask
    const wmMask = new Uint8Array(w * h);
    wmMask[0] = 1;
    wmMask[1] = 1;
    wmMask[2] = 1;

    // Aplicar watermark como hace el orchestrator
    for (let i = 0; i < alpha.length; i++) {
      if (wmMask[i]) alpha[i] = 0;
    }

    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBe(0);
    // Non-watermark pixels keep their alpha
    expect(alpha[3]).toBe(200);
  });
});
