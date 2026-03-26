import { describe, it, expect } from 'vitest';
import { simpleFloodFill } from '../../src/workers/cv/simple-flood-fill';
import { solidImage, paintRect, countBg } from '../helpers';

describe('simpleFloodFill', () => {
  it('marca todo como fondo en imagen solida', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);
    const colorA = [255, 255, 255];
    const colorB = [255, 255, 255];

    const mask = simpleFloodFill(pixels, w, h, colorA, colorB);

    expect(countBg(mask)).toBe(w * h);
  });

  it('no marca pixeles de un color distinto al fondo', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);
    // Pintar un sujeto rojo en el centro que no toca bordes
    paintRect(pixels, w, 20, 20, 24, 24, 255, 0, 0);

    const colorA = [255, 255, 255];
    const colorB = [255, 255, 255];

    const mask = simpleFloodFill(pixels, w, h, colorA, colorB);

    // Los pixeles del sujeto no deben ser fondo
    let subjectBg = 0;
    for (let y = 20; y < 44; y++) {
      for (let x = 20; x < 44; x++) {
        if (mask[y * w + x]) subjectBg++;
      }
    }
    expect(subjectBg).toBe(0);

    // Pero el fondo circundante si debe estar marcado
    expect(countBg(mask)).toBeGreaterThan(w * h - 24 * 24 - 10);
  });

  it('funciona con fondo negro', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 0, 0, 0);
    paintRect(pixels, w, 20, 20, 10, 10, 200, 100, 50);

    const mask = simpleFloodFill(pixels, w, h, [0, 0, 0], [0, 0, 0]);

    // El fondo debe marcarse, el sujeto no
    let subjectBg = 0;
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) {
        if (mask[y * w + x]) subjectBg++;
      }
    }
    expect(subjectBg).toBe(0);
  });

  it('no invade sujeto que toca el borde si color difiere', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);
    // Sujeto azul tocando borde izquierdo
    paintRect(pixels, w, 0, 20, 10, 24, 0, 0, 255);

    const mask = simpleFloodFill(pixels, w, h, [255, 255, 255], [255, 255, 255]);

    let subjectBg = 0;
    for (let y = 20; y < 44; y++) {
      for (let x = 0; x < 10; x++) {
        if (mask[y * w + x]) subjectBg++;
      }
    }
    expect(subjectBg).toBe(0);
  });

  it('acepta dos colores de fondo distintos (colorA y colorB)', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 200, 200, 200);
    // Mitad izquierda con un color, derecha con otro
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w / 2; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = 100;
        pixels[i + 1] = 100;
        pixels[i + 2] = 100;
      }
    }

    const mask = simpleFloodFill(pixels, w, h, [100, 100, 100], [200, 200, 200]);
    // Todos los pixeles deben ser fondo
    expect(countBg(mask)).toBe(w * h);
  });

  it('maneja imagen 1x1', () => {
    const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
    const mask = simpleFloodFill(pixels, 1, 1, [128, 128, 128], [128, 128, 128]);
    expect(mask[0]).toBe(1);
  });
});
