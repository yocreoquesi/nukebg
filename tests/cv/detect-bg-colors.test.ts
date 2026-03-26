import { describe, it, expect } from 'vitest';
import { detectBgColors } from '../../src/workers/cv/detect-bg-colors';
import { solidImage, checkerboardImage } from '../helpers';

describe('detectBgColors', () => {
  it('detecta fondo solido blanco', () => {
    const pixels = solidImage(100, 100, 255, 255, 255);
    const result = detectBgColors(pixels, 100, 100);

    expect(result.isCheckerboard).toBe(false);
    expect(result.colorA).toEqual([255, 255, 255]);
    expect(result.colorB).toEqual([255, 255, 255]);
    expect(result.cornerVariance).toBeLessThan(15);
  });

  it('detecta fondo solido negro', () => {
    const pixels = solidImage(100, 100, 0, 0, 0);
    const result = detectBgColors(pixels, 100, 100);

    expect(result.isCheckerboard).toBe(false);
    expect(result.colorA).toEqual([0, 0, 0]);
  });

  it('detecta fondo solido de color arbitrario', () => {
    const pixels = solidImage(200, 200, 120, 80, 200);
    const result = detectBgColors(pixels, 200, 200);

    expect(result.isCheckerboard).toBe(false);
    expect(result.colorA[0]).toBeCloseTo(120, -1);
    expect(result.colorA[1]).toBeCloseTo(80, -1);
    expect(result.colorA[2]).toBeCloseTo(200, -1);
  });

  it('detecta checkerboard clasico gris claro / gris oscuro', () => {
    const pixels = checkerboardImage(200, 200, 16, [191, 191, 191], [255, 255, 255]);
    const result = detectBgColors(pixels, 200, 200);

    expect(result.isCheckerboard).toBe(true);
    expect(result.cornerVariance).toBeGreaterThanOrEqual(15);
    // colorA debe ser el oscuro, colorB el claro
    const darkBrightness = (result.colorA[0] + result.colorA[1] + result.colorA[2]) / 3;
    const lightBrightness = (result.colorB[0] + result.colorB[1] + result.colorB[2]) / 3;
    expect(darkBrightness).toBeLessThan(lightBrightness);
  });

  it('detecta checkerboard con colores custom', () => {
    const pixels = checkerboardImage(200, 200, 20, [100, 100, 100], [200, 200, 200]);
    const result = detectBgColors(pixels, 200, 200);

    expect(result.isCheckerboard).toBe(true);
  });

  it('no confunde un sujeto central con checkerboard si las esquinas son solidas', () => {
    // Imagen 200x200 con fondo blanco y un rectangulo rojo en el centro
    const pixels = solidImage(200, 200, 255, 255, 255);
    // Pintar centro rojo (no toca las esquinas)
    for (let y = 60; y < 140; y++) {
      for (let x = 60; x < 140; x++) {
        const i = (y * 200 + x) * 4;
        pixels[i] = 255;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
      }
    }
    const result = detectBgColors(pixels, 200, 200);

    expect(result.isCheckerboard).toBe(false);
    // Las esquinas son blancas
    expect(result.colorA[0]).toBe(255);
  });

  it('respeta sampleSize custom', () => {
    const pixels = solidImage(100, 100, 128, 128, 128);
    const result = detectBgColors(pixels, 100, 100, 10);

    expect(result.isCheckerboard).toBe(false);
    expect(result.colorA).toEqual([128, 128, 128]);
  });

  it('maneja imagenes pequenas sin crash', () => {
    const pixels = solidImage(8, 8, 200, 200, 200);
    const result = detectBgColors(pixels, 8, 8);

    expect(result.isCheckerboard).toBe(false);
  });
});
