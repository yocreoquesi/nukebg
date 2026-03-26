import { describe, it, expect } from 'vitest';
import { shadowCleanup } from '../../src/workers/cv/shadow-cleanup';
import { solidImage, paintRect } from '../helpers';

/**
 * Tests de spatial refinement: removeSmallClusters / shadowCleanup.
 *
 * shadowCleanup identifica clusters pequenos de foreground con baja saturacion
 * (sombras, artefactos) y los reclasifica como background.
 */

describe('shadowCleanup (spatial refinement / removeSmallClusters)', () => {
  it('elimina un blob gris pequeno desconectado del sujeto', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Sujeto colorido grande (no sera eliminado)
    paintRect(pixels, w, 20, 20, 24, 24, 200, 50, 50);

    // Blob gris pequeno (sombra/artefacto) -- baja saturacion
    paintRect(pixels, w, 2, 2, 4, 4, 80, 80, 80);

    // Mask inicial: todo fondo excepto sujeto y blob
    const mask = new Uint8Array(w * h);
    mask.fill(1); // todo background
    // Sujeto = foreground
    for (let y = 20; y < 44; y++) {
      for (let x = 20; x < 44; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob = foreground
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // El blob gris debe haber sido eliminado (marcado como background)
    expect(result[3 * w + 3]).toBe(1); // centro del blob

    // El sujeto colorido debe permanecer como foreground
    expect(result[32 * w + 32]).toBe(0);
  });

  it('no elimina un blob grande (supera maxBlobSize)', () => {
    const w = 128, h = 128;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Blob gris grande (>maxBlobSize por defecto)
    paintRect(pixels, w, 0, 0, 128, 128, 100, 100, 100);

    // Todo foreground
    const mask = new Uint8Array(w * h); // todo foreground (0)

    const result = shadowCleanup(pixels, w, h, mask, 100);

    // Con maxBlobSize=100, el blob de 128*128 no cabe, asi que NO se limpia
    // (el blob excede maxBlobSize, se marca overflow y se conserva)
    // Verificar que al menos los pixeles siguen como foreground
    let fgCount = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === 0) fgCount++;
    }
    // El blob grande no fue eliminado
    expect(fgCount).toBeGreaterThan(100);
  });

  it('no toca pixeles que ya son background', () => {
    const w = 16, h = 16;
    const pixels = solidImage(w, h, 255, 255, 255);

    const mask = new Uint8Array(w * h);
    mask.fill(1); // todo background

    const result = shadowCleanup(pixels, w, h, mask);

    // Todo sigue como background
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(1);
    }
  });

  it('no elimina foreground con alta saturacion (color real, no sombra)', () => {
    const w = 32, h = 32;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Blob muy colorido (alta saturacion)
    paintRect(pixels, w, 5, 5, 6, 6, 255, 0, 0);

    // Mask: blob es foreground, resto background
    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 5; y < 11; y++) {
      for (let x = 5; x < 11; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // El blob colorido (rojo puro, sat=1.0) NO debe ser eliminado
    expect(result[7 * w + 7]).toBe(0);
  });

  it('elimina multiples blobs pequenos de sombra independientes', () => {
    const w = 64, h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Sujeto real
    paintRect(pixels, w, 25, 25, 14, 14, 200, 50, 50);

    // Blob sombra 1
    paintRect(pixels, w, 2, 2, 3, 3, 70, 70, 70);
    // Blob sombra 2
    paintRect(pixels, w, 55, 55, 3, 3, 90, 90, 90);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    // Sujeto
    for (let y = 25; y < 39; y++) {
      for (let x = 25; x < 39; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob 1
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob 2
    for (let y = 55; y < 58; y++) {
      for (let x = 55; x < 58; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // Ambos blobs de sombra eliminados
    expect(result[3 * w + 3]).toBe(1);
    expect(result[56 * w + 56]).toBe(1);

    // Sujeto intacto
    expect(result[32 * w + 32]).toBe(0);
  });

  it('maneja imagen sin foreground (todo background)', () => {
    const w = 16, h = 16;
    const pixels = solidImage(w, h, 128, 128, 128);
    const mask = new Uint8Array(w * h).fill(1);

    // No debe crashear
    const result = shadowCleanup(pixels, w, h, mask);
    expect(result.length).toBe(w * h);
  });

  it('maneja imagen todo foreground (sin background)', () => {
    const w = 16, h = 16;
    const pixels = solidImage(w, h, 200, 50, 50);
    const mask = new Uint8Array(w * h); // todo foreground

    const result = shadowCleanup(pixels, w, h, mask);
    expect(result.length).toBe(w * h);
  });

  it('respeta el parametro maxBlobSize personalizado', () => {
    const w = 32, h = 32;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Blob gris de 5x5 = 25 pixeles
    paintRect(pixels, w, 2, 2, 5, 5, 80, 80, 80);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) {
        mask[y * w + x] = 0;
      }
    }

    // Con maxBlobSize=10, el blob de 25px NO se elimina (excede)
    const resultSmall = shadowCleanup(pixels, w, h, new Uint8Array(mask), 10);
    expect(resultSmall[4 * w + 4]).toBe(0);

    // Con maxBlobSize=30, el blob de 25px SI se elimina
    const resultBig = shadowCleanup(pixels, w, h, new Uint8Array(mask), 30);
    expect(resultBig[4 * w + 4]).toBe(1);
  });

  it('no elimina pixeles brillantes (brightness > MAX) ni oscuros (brightness < MIN)', () => {
    const w = 32, h = 32;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Blob casi blanco (brightness > BRIGHTNESS_MAX=220)
    paintRect(pixels, w, 2, 2, 3, 3, 240, 240, 240);

    // Blob casi negro (brightness < BRIGHTNESS_MIN=5)
    paintRect(pixels, w, 10, 10, 3, 3, 2, 2, 2);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        mask[y * w + x] = 0;
      }
    }
    for (let y = 10; y < 13; y++) {
      for (let x = 10; x < 13; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // Ambos blobs no son candidatos a sombra (fuera del rango de brightness)
    // Por lo tanto siguen como foreground
    expect(result[3 * w + 3]).toBe(0);
    expect(result[11 * w + 11]).toBe(0);
  });
});
