import { describe, it, expect } from 'vitest';
import { gridFloodFill } from '../../src/workers/cv/grid-flood-fill';
import { checkerboardImage, paintRect, countBg } from '../helpers';

describe('gridFloodFill', () => {
  const dark: [number, number, number] = [191, 191, 191];
  const light: [number, number, number] = [255, 255, 255];

  it('marca todo como fondo en checkerboard puro (sin sujeto)', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    const mask = gridFloodFill(pixels, w, h, dark, light, gs, 0);

    const bgRatio = countBg(mask) / (w * h);
    // Deberia marcar >95% como fondo (todo excepto posibles bordes)
    expect(bgRatio).toBeGreaterThan(0.95);
  });

  it('preserva un sujeto central opaco', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Pintar un sujeto rojo de 40x40 en el centro
    paintRect(pixels, w, 44, 44, 40, 40, 255, 0, 0);

    const mask = gridFloodFill(pixels, w, h, dark, light, gs, 0);

    // El sujeto no debe estar marcado como fondo
    let subjectBgCount = 0;
    for (let y = 44; y < 84; y++) {
      for (let x = 44; x < 84; x++) {
        if (mask[y * w + x]) subjectBgCount++;
      }
    }
    // Casi ningun pixel del sujeto debe ser marcado bg
    expect(subjectBgCount).toBeLessThan(40 * 40 * 0.05);
  });

  it('funciona con grid de 32px', () => {
    const w = 256, h = 256, gs = 32;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    const mask = gridFloodFill(pixels, w, h, dark, light, gs, 0);

    const bgRatio = countBg(mask) / (w * h);
    expect(bgRatio).toBeGreaterThan(0.95);
  });

  it('respeta el parametro de tolerancia', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Con tolerancia 0, deberia ser mas estricto
    const maskStrict = gridFloodFill(pixels, w, h, dark, light, gs, 0, 0);
    const maskRelaxed = gridFloodFill(pixels, w, h, dark, light, gs, 0, 50);

    // Relajada deberia encontrar al menos tantos bg como estricta
    expect(countBg(maskRelaxed)).toBeGreaterThanOrEqual(countBg(maskStrict));
  });

  it('no crashea con imagen 1x1', () => {
    const pixels = new Uint8ClampedArray([191, 191, 191, 255]);
    const mask = gridFloodFill(pixels, 1, 1, dark, light, 8, 0);
    expect(mask.length).toBe(1);
  });
});
