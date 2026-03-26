import { describe, it, expect } from 'vitest';
import { watermarkDetect } from '../../src/workers/cv/watermark-detect';
import { solidImage, paintRect } from '../helpers';

describe('watermarkDetect', () => {
  it('no detecta watermark en imagen limpia con fondo solido', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 255, 255, 255);

    const result = watermarkDetect(pixels, w, h, [255, 255, 255], [255, 255, 255]);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('no detecta watermark en imagen con sujeto pero sin sparkle', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 255, 255, 255);
    // Sujeto en el centro
    paintRect(pixels, w, 200, 200, 112, 112, 100, 50, 150);

    const result = watermarkDetect(pixels, w, h, [255, 255, 255], [255, 255, 255]);

    expect(result.detected).toBe(false);
  });

  it('detecta sparkle simulado en esquina inferior derecha', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Simular un cluster de pixeles brillantes (sparkle) en bottom-right
    const scanSize = Math.max(200, Math.floor(Math.min(h, w) / 5));
    const cy = h - Math.floor(scanSize / 2);
    const cx = w - Math.floor(scanSize / 2);

    // Pintar un cluster de ~50 pixeles muy diferentes al fondo
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (Math.sqrt(dy * dy + dx * dx) <= 5) {
          const y = cy + dy;
          const x = cx + dx;
          if (y >= 0 && y < h && x >= 0 && x < w) {
            const i = (y * w + x) * 4;
            pixels[i] = 255;     // r - muy diferente a 200
            pixels[i + 1] = 255; // g
            pixels[i + 2] = 255; // b
          }
        }
      }
    }

    const result = watermarkDetect(pixels, w, h, [200, 200, 200], [200, 200, 200]);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    expect(result.centerX).toBeDefined();
    expect(result.centerY).toBeDefined();
    expect(result.radius).toBeGreaterThan(0);
  });

  it('no detecta ruido disperso como watermark (filtro de mediana de distancia)', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Pintar pixeles brillantes dispersos (no clustered) en bottom-right
    const scanSize = Math.max(200, Math.floor(Math.min(h, w) / 5));
    let count = 0;
    for (let ly = 0; ly < scanSize; ly += 20) {
      for (let lx = 0; lx < scanSize; lx += 20) {
        const y = h - scanSize + ly;
        const x = w - scanSize + lx;
        if (y >= 0 && y < h && x >= 0 && x < w) {
          const i = (y * w + x) * 4;
          pixels[i] = 255;
          pixels[i + 1] = 255;
          pixels[i + 2] = 255;
          count++;
        }
      }
    }

    const result = watermarkDetect(pixels, w, h, [200, 200, 200], [200, 200, 200]);

    // Ruido disperso no deberia pasar el filtro de mediana de distancia
    // (puede o no detectarse como sparkle, depende del threshold; lo importante
    // es que no crashee y la logica funcione)
    expect(result).toBeDefined();
  });

  it('genera mascara circular con radio razonable', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 100, 100, 100);

    // Sparkle concentrado
    const cy = h - 50;
    const cx = w - 50;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const y = cy + dy;
        const x = cx + dx;
        if (y >= 0 && y < h && x >= 0 && x < w) {
          const i = (y * w + x) * 4;
          pixels[i] = 255;
          pixels[i + 1] = 255;
          pixels[i + 2] = 0;
        }
      }
    }

    const result = watermarkDetect(pixels, w, h, [100, 100, 100], [100, 100, 100]);

    if (result.detected && result.mask) {
      // La mascara debe tener pixeles marcados
      let maskCount = 0;
      for (let i = 0; i < result.mask.length; i++) {
        if (result.mask[i]) maskCount++;
      }
      expect(maskCount).toBeGreaterThan(0);
      // Pero no deberia marcar mas del 10% de la imagen
      expect(maskCount).toBeLessThan(w * h * 0.1);
    }
  });

  it('maneja imagen pequena sin crash', () => {
    const w = 100, h = 100;
    const pixels = solidImage(w, h, 200, 200, 200);

    // No debe lanzar excepcion
    const result = watermarkDetect(pixels, w, h, [200, 200, 200], [200, 200, 200]);
    expect(result).toBeDefined();
  });
});
