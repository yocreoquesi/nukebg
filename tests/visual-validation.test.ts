import { describe, it, expect } from 'vitest';
import { detectBgColors } from '../src/workers/cv/detect-bg-colors';
import { detectCheckerGrid } from '../src/workers/cv/detect-checker-grid';
import { gridFloodFill } from '../src/workers/cv/grid-flood-fill';
import { subjectExclusion } from '../src/workers/cv/subject-exclusion';
import { simpleFloodFill } from '../src/workers/cv/simple-flood-fill';
import { watermarkDetect } from '../src/workers/cv/watermark-detect';
import { shadowCleanup } from '../src/workers/cv/shadow-cleanup';
import { alphaRefine } from '../src/workers/cv/alpha-refine';
import { CV_PARAMS } from '../src/pipeline/constants';
import { solidImage, checkerboardImage, paintRect } from './helpers';

/**
 * Validacion visual con imagenes sinteticas de mascota.
 *
 * Crea imagenes sinteticas que simulan los tipos de mascot images
 * (checkerboard, fondo blanco, fondo negro, etc.) y verifica que
 * el pipeline CV produce resultados con >20% foreground.
 */

function runCvPipeline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): { alpha: Uint8Array; fgPercent: number } {
  const bgInfo = detectBgColors(pixels, width, height);

  let bgMask: Uint8Array;

  if (bgInfo.isCheckerboard) {
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
      bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
    }
  } else if (bgInfo.cornerVariance < CV_PARAMS.SOLID_BG_VARIANCE) {
    bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  } else {
    bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  }

  const wm = watermarkDetect(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  if (wm.detected && wm.mask) {
    const newMask = new Uint8Array(width * height);
    for (let i = 0; i < newMask.length; i++) {
      newMask[i] = bgMask[i] || wm.mask[i] ? 1 : 0;
    }
    bgMask = newMask;
  }

  bgMask = shadowCleanup(pixels, width, height, bgMask);
  const alpha = alphaRefine(bgMask, width, height);

  let fgCount = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 128) fgCount++;
  }
  const fgPercent = (fgCount / (width * height)) * 100;

  return { alpha, fgPercent };
}

describe('Validacion visual: mascot images sinteticas', () => {

  it('mascot-cartoon: sujeto colorido sobre checkerboard tiene >20% foreground', () => {
    const w = 256, h = 256, gs = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Mascota cartoon: forma irregular con multiples colores
    paintRect(pixels, w, 80, 40, 96, 176, 220, 60, 60);   // cuerpo rojo
    paintRect(pixels, w, 100, 50, 56, 40, 255, 200, 150);  // cara
    paintRect(pixels, w, 100, 150, 56, 40, 60, 60, 200);   // pies azules
    paintRect(pixels, w, 70, 80, 20, 60, 220, 60, 60);     // brazo izq
    paintRect(pixels, w, 166, 80, 20, 60, 220, 60, 60);    // brazo der

    const { fgPercent } = runCvPipeline(pixels, w, h);
    expect(fgPercent).toBeGreaterThan(20);
  });

  it('mascot-geometric: formas geometricas sobre fondo blanco tiene >20% foreground', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Mascota geometrica: triangulo + circulo simulados con rects
    paintRect(pixels, w, 60, 30, 136, 196, 50, 150, 200);  // cuerpo azul
    paintRect(pixels, w, 90, 50, 76, 76, 255, 200, 50);     // cara amarilla
    paintRect(pixels, w, 100, 180, 56, 40, 50, 200, 50);    // pies verdes

    const { fgPercent } = runCvPipeline(pixels, w, h);
    expect(fgPercent).toBeGreaterThan(20);
  });

  it('mascot-realistic: sujeto con detalles sobre fondo negro tiene >20% foreground', () => {
    const w = 256, h = 256;
    const pixels = solidImage(w, h, 0, 0, 0);

    // Mascota realista: tonos de piel y ropa
    paintRect(pixels, w, 70, 30, 116, 196, 180, 130, 90);   // cuerpo
    paintRect(pixels, w, 90, 40, 76, 76, 220, 180, 150);     // cara
    paintRect(pixels, w, 70, 140, 116, 86, 50, 50, 150);     // pantalones
    paintRect(pixels, w, 85, 200, 40, 26, 80, 40, 20);       // zapato izq
    paintRect(pixels, w, 131, 200, 40, 26, 80, 40, 20);      // zapato der

    const { fgPercent } = runCvPipeline(pixels, w, h);
    expect(fgPercent).toBeGreaterThan(20);
  });

  it('mascot-pixel: pixel art sobre checkerboard tiene >20% foreground', () => {
    const w = 128, h = 128, gs = 8;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Mascota pixel art: bloques solidos
    paintRect(pixels, w, 40, 16, 48, 96, 200, 80, 80);    // cuerpo
    paintRect(pixels, w, 48, 24, 32, 24, 255, 200, 160);   // cara
    paintRect(pixels, w, 48, 80, 16, 24, 200, 80, 80);     // pie izq
    paintRect(pixels, w, 72, 80, 16, 24, 200, 80, 80);     // pie der

    const { fgPercent } = runCvPipeline(pixels, w, h);
    expect(fgPercent).toBeGreaterThan(20);
  });

  it('mascot-icon-m: icono M sobre fondo gris tiene >20% foreground', () => {
    const w = 128, h = 128;
    // Fondo gris solido
    const pixels = solidImage(w, h, 220, 220, 220);

    // Letra M estilizada
    paintRect(pixels, w, 20, 20, 88, 88, 30, 30, 150);     // fondo azul oscuro
    paintRect(pixels, w, 30, 30, 12, 68, 255, 255, 255);    // pata izq M
    paintRect(pixels, w, 86, 30, 12, 68, 255, 255, 255);    // pata der M
    paintRect(pixels, w, 42, 45, 12, 30, 255, 255, 255);    // diagonal izq
    paintRect(pixels, w, 60, 45, 12, 30, 255, 255, 255);    // diagonal der
    paintRect(pixels, w, 50, 55, 14, 15, 255, 255, 255);    // centro V

    const { fgPercent } = runCvPipeline(pixels, w, h);
    expect(fgPercent).toBeGreaterThan(20);
  });

  it('todas las mascot images producen alpha con valores validos (0-255)', () => {
    const images = [
      { name: 'solid-white', pixels: (() => { const p = solidImage(64, 64, 255, 255, 255); paintRect(p, 64, 16, 16, 32, 32, 100, 50, 50); return p; })() },
      { name: 'solid-black', pixels: (() => { const p = solidImage(64, 64, 0, 0, 0); paintRect(p, 64, 16, 16, 32, 32, 200, 150, 100); return p; })() },
      { name: 'checker', pixels: (() => { const p = checkerboardImage(64, 64, 8, [191, 191, 191], [255, 255, 255]); paintRect(p, 64, 16, 16, 32, 32, 200, 50, 50); return p; })() },
    ];

    for (const { pixels } of images) {
      const { alpha, fgPercent } = runCvPipeline(pixels, 64, 64);

      // Alpha valido
      for (let i = 0; i < alpha.length; i++) {
        expect(alpha[i]).toBeGreaterThanOrEqual(0);
        expect(alpha[i]).toBeLessThanOrEqual(255);
      }

      // Tiene foreground
      expect(fgPercent).toBeGreaterThan(0);
    }
  });

  it('el pipeline no crashea con imagenes de diferentes tamanos', () => {
    const sizes = [
      { w: 32, h: 32 },
      { w: 64, h: 64 },
      { w: 128, h: 128 },
      { w: 256, h: 256 },
      { w: 512, h: 512 },
    ];

    for (const { w, h } of sizes) {
      const pixels = solidImage(w, h, 255, 255, 255);
      paintRect(pixels, w, Math.floor(w * 0.25), Math.floor(h * 0.25),
        Math.floor(w * 0.5), Math.floor(h * 0.5), 200, 50, 50);

      const { alpha, fgPercent } = runCvPipeline(pixels, w, h);

      expect(alpha.length).toBe(w * h);
      expect(fgPercent).toBeGreaterThan(10);
    }
  });
});
