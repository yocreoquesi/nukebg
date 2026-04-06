import { describe, it, expect } from 'vitest';
import { shadowCleanup } from '../../src/workers/cv/shadow-cleanup';
import { solidImage, paintRect, countBg } from '../helpers';

describe('shadowCleanup', () => {
  it('no modifica la mascara si no hay sombras', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 0, 0); // sujeto rojo saturado
    // Mascara donde todo el borde es fondo
    const mask = new Uint8Array(w * h);
    // Only the border is background
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y < 5 || y >= h - 5 || x < 5 || x >= w - 5) {
          mask[y * w + x] = 1;
        }
      }
    }
    const bgBefore = countBg(mask);

    const result = shadowCleanup(pixels, w, h, mask);

    // No deberia marcar mas fondo porque el interior es rojo saturado
    expect(countBg(result)).toBe(bgBefore);
  });

  it('marca sombras pequenas como fondo', () => {
    const w = 128, h = 128;
    // Fondo blanco con un sujeto colorido
    const pixels = solidImage(w, h, 255, 255, 255);
    // Sujeto rojo en el centro
    paintRect(pixels, w, 40, 40, 48, 48, 200, 50, 50);
    // Sombra gris (baja saturacion) como isla desconectada
    paintRect(pixels, w, 10, 10, 8, 8, 80, 80, 80);

    // Mascara donde el fondo blanco ya esta marcado, pero la sombra NO
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) {
          mask[y * w + x] = 1;
        }
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // La sombra gris deberia ser marcada como fondo ahora
    let shadowMarked = 0;
    for (let y = 10; y < 18; y++) {
      for (let x = 10; x < 18; x++) {
        if (result[y * w + x]) shadowMarked++;
      }
    }
    expect(shadowMarked).toBeGreaterThan(0);
  });

  it('no marca blobs grandes como fondo (limite maxBlobSize)', () => {
    const w = 200, h = 200;
    const pixels = solidImage(w, h, 255, 255, 255);
    // Blob gris grande (mayor que maxBlobSize=100 para este test)
    paintRect(pixels, w, 50, 50, 60, 60, 80, 80, 80);

    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (pixels[i] === 255) mask[y * w + x] = 1;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask, 100);

    // El blob gris grande NO deberia marcarse como fondo (3600 > 100)
    let blobMarked = 0;
    for (let y = 50; y < 110; y++) {
      for (let x = 50; x < 110; x++) {
        if (result[y * w + x]) blobMarked++;
      }
    }
    expect(blobMarked).toBe(0);
  });

  it('no toca pixeles saturados (sujeto colorido)', () => {
    const w = 64, h = 64;
    // Sujeto rojo intenso (saturacion alta)
    const pixels = solidImage(w, h, 255, 0, 0);
    const mask = new Uint8Array(w * h); // todo foreground

    const result = shadowCleanup(pixels, w, h, mask);

    // Nada deberia cambiar porque todo es saturado
    expect(countBg(result)).toBe(0);
  });

  it('maneja mascara vacia (todo foreground)', () => {
    const w = 32, h = 32;
    const pixels = solidImage(w, h, 100, 100, 100);
    const mask = new Uint8Array(w * h);

    const result = shadowCleanup(pixels, w, h, mask);
    expect(result).toBeDefined();
    expect(result.length).toBe(w * h);
  });

  it('maneja mascara llena (todo background)', () => {
    const w = 32, h = 32;
    const pixels = solidImage(w, h, 100, 100, 100);
    const mask = new Uint8Array(w * h).fill(1);

    const result = shadowCleanup(pixels, w, h, mask);
    // Todo sigue siendo fondo
    expect(countBg(result)).toBe(w * h);
  });
});
