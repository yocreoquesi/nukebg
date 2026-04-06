import { describe, it, expect } from 'vitest';
import { subjectExclusion } from '../../src/workers/cv/subject-exclusion';
import { checkerboardImage, paintRect, countBg } from '../helpers';

describe('subjectExclusion', () => {
  const dark: [number, number, number] = [191, 191, 191];
  const light: [number, number, number] = [255, 255, 255];

  it('marca todo como fondo en checkerboard puro', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    const mask = subjectExclusion(pixels, w, h, dark, light, gs, 0);

    const bgRatio = countBg(mask) / (w * h);
    // En checkerboard puro, la mayoria deberia ser fondo
    expect(bgRatio).toBeGreaterThan(0.8);
  });

  it('identifica sujeto colorido central', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    // Sujeto rojo brillante de 48x48 en el centro
    paintRect(pixels, w, 40, 40, 48, 48, 255, 0, 0);

    const mask = subjectExclusion(pixels, w, h, dark, light, gs, 0);

    // Verify that the subject is foreground (not marked as bg)
    let subjectBg = 0;
    // Verificar solo el interior (alejado del borde de celda)
    for (let y = 48; y < 80; y++) {
      for (let x = 48; x < 80; x++) {
        if (mask[y * w + x]) subjectBg++;
      }
    }
    const subjectPixels = 32 * 32;
    expect(subjectBg / subjectPixels).toBeLessThan(0.2);
  });

  it('el fondo checkerboard alrededor del sujeto se marca como bg', () => {
    const w = 128, h = 128, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);
    paintRect(pixels, w, 40, 40, 48, 48, 0, 200, 0);

    const mask = subjectExclusion(pixels, w, h, dark, light, gs, 0);

    // Las esquinas (puro checker) deben ser fondo
    let cornerBg = 0;
    let cornerTotal = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        cornerTotal++;
        if (mask[y * w + x]) cornerBg++;
      }
    }
    expect(cornerBg / cornerTotal).toBeGreaterThan(0.5);
  });

  it('devuelve todo fondo si no hay sujeto detectable (baja saturacion)', () => {
    const w = 64, h = 64, gs = 16;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    const mask = subjectExclusion(pixels, w, h, dark, light, gs, 0);

    // Sin sujeto, todo deberia ser fondo
    const bgRatio = countBg(mask) / (w * h);
    expect(bgRatio).toBeGreaterThan(0.8);
  });

  it('maneja imagen pequena sin crash', () => {
    const w = 16, h = 16, gs = 8;
    const pixels = checkerboardImage(w, h, gs, dark, light);

    const mask = subjectExclusion(pixels, w, h, dark, light, gs, 0);
    expect(mask.length).toBe(w * h);
  });
});
