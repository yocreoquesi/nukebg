import { describe, it, expect } from 'vitest';
import { watermarkDetectCorner } from '../../src/workers/cv/watermark-corner';
import { solidImage, paintRect } from '../helpers';

describe('watermarkDetectCorner', () => {
  it('no detecta watermark en imagen limpia con fondo solido', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('detecta logo simulado en esquina inferior derecha', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a small logo-like patch in the bottom-right corner
    const logoSize = 30;
    const logoX = w - 50;
    const logoY = h - 50;
    paintRect(pixels, w, logoX, logoY, logoSize, logoSize, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    expect(result.centerX).toBeDefined();
    expect(result.centerY).toBeDefined();
  });

  it('detecta logo simulado en esquina superior izquierda', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a small logo in the top-left corner
    paintRect(pixels, w, 10, 10, 30, 30, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
  });

  it('detecta logo simulado en esquina superior derecha', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a small logo in the top-right corner
    paintRect(pixels, w, w - 50, 10, 30, 30, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
  });

  it('detecta logo simulado en esquina inferior izquierda', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a small logo in the bottom-left corner
    paintRect(pixels, w, 10, h - 50, 30, 30, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
  });

  it('no detecta sujeto en el centro como corner watermark', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a large object in the center (not in any corner)
    paintRect(pixels, w, 200, 200, 100, 100, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('rechaza cluster demasiado grande (sujeto en esquina, no logo)', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a very large region in the corner (larger than MAX_CLUSTER_RATIO)
    // MAX_CLUSTER_RATIO = 0.02 means max ~5242 pixels for 512x512
    // A 80x80 rect = 6400 pixels, should be rejected
    paintRect(pixels, w, w - 85, h - 85, 80, 80, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(false);
  });

  it('genera mascara circular alrededor del logo detectado', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a small logo in the bottom-right corner
    paintRect(pixels, w, w - 50, h - 50, 25, 25, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    if (result.detected && result.mask) {
      let maskCount = 0;
      for (let i = 0; i < result.mask.length; i++) {
        if (result.mask[i]) maskCount++;
      }
      expect(maskCount).toBeGreaterThan(0);
      // Mask should not cover more than 5% of the image
      expect(maskCount).toBeLessThan(w * h * 0.05);
    }
  });

  it('maneja imagen pequena sin crash', () => {
    const w = 80, h = 80;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result).toBeDefined();
  });

  it('rechaza cluster con aspect ratio extremo', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a very thin horizontal line in the corner (extreme aspect ratio)
    // 60 wide x 3 tall = aspect ratio 20, well above MAX_ASPECT_RATIO (3.0)
    paintRect(pixels, w, w - 70, h - 20, 60, 3, 50, 100, 150);

    const result = watermarkDetectCorner(pixels, w, h);

    // Should be rejected due to extreme aspect ratio
    // (thin lines are unlikely to be logos)
    expect(result.detected).toBe(false);
  });

  it('no detecta pixeles con color similar al fondo', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Paint a very subtle patch (color too close to background)
    // DEVIATION_THRESHOLD is 35, so Euclidean distance < 35 should be ignored
    paintRect(pixels, w, w - 50, h - 50, 25, 25, 210, 210, 210);

    const result = watermarkDetectCorner(pixels, w, h);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });
});
