import { describe, it, expect } from 'vitest';
import { guidedFilter, jointBilateralUpsample } from '../../src/workers/cv/alpha-matting';

/** Create a simple RGBA pixel buffer filled with a single grayscale value */
function makePixels(w: number, h: number, gray: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    px[off] = gray;
    px[off + 1] = gray;
    px[off + 2] = gray;
    px[off + 3] = 255;
  }
  return px;
}

describe('guidedFilter (alpha matting)', () => {
  it('binary mask: smooths borders without destroying core regions', () => {
    const w = 64, h = 64;
    const alpha = new Uint8Array(w * h);
    const pixels = new Uint8ClampedArray(w * h * 4);

    // Left half = subject (white), right half = background (dark)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < w / 2) {
          alpha[i] = 255;
          pixels[i * 4] = 200;
          pixels[i * 4 + 1] = 200;
          pixels[i * 4 + 2] = 200;
        } else {
          alpha[i] = 0;
          pixels[i * 4] = 30;
          pixels[i * 4 + 1] = 30;
          pixels[i * 4 + 2] = 30;
        }
        pixels[i * 4 + 3] = 255;
      }
    }

    const result = guidedFilter(alpha, pixels, w, h, 5, 1e-4);

    // Deep subject pixels should remain mostly opaque
    expect(result[h / 2 * w + 5]).toBeGreaterThan(200);

    // Deep background pixels should remain mostly transparent
    expect(result[h / 2 * w + (w - 5)]).toBeLessThan(55);

    // Border region (around x=32) should contain intermediate values
    const borderVal = result[h / 2 * w + w / 2];
    expect(borderVal).toBeGreaterThanOrEqual(0);
    expect(borderVal).toBeLessThanOrEqual(255);
  });

  it('already-smooth mask: does not degrade quality', () => {
    const w = 32, h = 32;
    // Create a smooth gradient mask
    const alpha = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        alpha[y * w + x] = Math.round((x / (w - 1)) * 255);
      }
    }
    const pixels = makePixels(w, h, 128);

    const result = guidedFilter(alpha, pixels, w, h, 3, 1e-4);

    // Should still be a gradient (left should be darker, right brighter)
    const leftAvg = (result[h / 2 * w + 0] + result[h / 2 * w + 1] + result[h / 2 * w + 2]) / 3;
    const rightAvg = (result[h / 2 * w + (w - 1)] + result[h / 2 * w + (w - 2)] + result[h / 2 * w + (w - 3)]) / 3;
    expect(rightAvg).toBeGreaterThan(leftAvg);

    // All values in valid range
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(255);
    }
  });

  it('all-opaque mask stays opaque', () => {
    const w = 16, h = 16;
    const alpha = new Uint8Array(w * h).fill(255);
    const pixels = makePixels(w, h, 180);

    const result = guidedFilter(alpha, pixels, w, h, 5, 1e-4);

    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(240);
    }
  });

  it('all-transparent mask stays transparent', () => {
    const w = 16, h = 16;
    const alpha = new Uint8Array(w * h).fill(0);
    const pixels = makePixels(w, h, 100);

    const result = guidedFilter(alpha, pixels, w, h, 5, 1e-4);

    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeLessThan(15);
    }
  });

  it('handles 1x1 image without crash', () => {
    const alpha = new Uint8Array([128]);
    const pixels = new Uint8ClampedArray([100, 100, 100, 255]);

    const result = guidedFilter(alpha, pixels, 1, 1, 5, 1e-4);
    expect(result.length).toBe(1);
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(255);
  });

  it('performance: 1024x1024 completes in <500ms', () => {
    const w = 1024, h = 1024;
    const alpha = new Uint8Array(w * h);
    // Create a circle mask
    const cx = w / 2, cy = h / 2, r = w / 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        alpha[y * w + x] = dist < r ? 255 : 0;
      }
    }
    const pixels = makePixels(w, h, 150);

    const start = performance.now();
    const result = guidedFilter(alpha, pixels, w, h, 15, 1e-4);
    const elapsed = performance.now() - start;

    expect(result.length).toBe(w * h);
    expect(elapsed).toBeLessThan(500);
  });

  it('produces values strictly within [0, 255]', () => {
    const w = 50, h = 50;
    const alpha = new Uint8Array(w * h);
    const pixels = new Uint8ClampedArray(w * h * 4);

    // Random-ish pattern to stress the filter
    for (let i = 0; i < w * h; i++) {
      alpha[i] = (i * 17 + 5) % 256;
      const off = i * 4;
      pixels[off] = (i * 7 + 3) % 256;
      pixels[off + 1] = (i * 13 + 11) % 256;
      pixels[off + 2] = (i * 23 + 19) % 256;
      pixels[off + 3] = 255;
    }

    const result = guidedFilter(alpha, pixels, w, h, 5, 1e-4);

    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe('jointBilateralUpsample', () => {
  it('upscales to correct dimensions', () => {
    const lowW = 8, lowH = 8, hiW = 32, hiH = 32;
    const lowAlpha = new Uint8Array(lowW * lowH).fill(128);
    const hiPixels = makePixels(hiW, hiH, 150);

    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 3, 2, 25);
    expect(result.length).toBe(hiW * hiH);
  });

  it('preserves hard edges aligned with guidance', () => {
    const lowW = 16, lowH = 16, hiW = 64, hiH = 64;

    // Low-res mask: left half opaque, right half transparent
    const lowAlpha = new Uint8Array(lowW * lowH);
    for (let y = 0; y < lowH; y++) {
      for (let x = 0; x < lowW; x++) {
        lowAlpha[y * lowW + x] = x < lowW / 2 ? 255 : 0;
      }
    }

    // High-res guidance: same split — white left, dark right
    const hiPixels = new Uint8ClampedArray(hiW * hiH * 4);
    for (let y = 0; y < hiH; y++) {
      for (let x = 0; x < hiW; x++) {
        const off = (y * hiW + x) * 4;
        const val = x < hiW / 2 ? 220 : 20;
        hiPixels[off] = val;
        hiPixels[off + 1] = val;
        hiPixels[off + 2] = val;
        hiPixels[off + 3] = 255;
      }
    }

    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 4, 2, 20);

    // Deep inside subject (x=8) should be very opaque
    expect(result[hiH / 2 * hiW + 8]).toBeGreaterThan(200);

    // Deep inside background (x=56) should be very transparent
    expect(result[hiH / 2 * hiW + 56]).toBeLessThan(55);
  });

  it('same-size returns copy', () => {
    const w = 8, h = 8;
    const alpha = new Uint8Array(w * h).fill(100);
    const pixels = makePixels(w, h, 128);

    const result = jointBilateralUpsample(alpha, w, h, pixels, w, h, 3, 2, 25);
    expect(result.length).toBe(w * h);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(100);
    }
  });

  it('all-opaque mask stays mostly opaque after upscale', () => {
    const lowW = 8, lowH = 8, hiW = 32, hiH = 32;
    const lowAlpha = new Uint8Array(lowW * lowH).fill(255);
    const hiPixels = makePixels(hiW, hiH, 128);

    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 4, 3, 25);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(240);
    }
  });

  it('all-transparent mask stays transparent after upscale', () => {
    const lowW = 8, lowH = 8, hiW = 32, hiH = 32;
    const lowAlpha = new Uint8Array(lowW * lowH).fill(0);
    const hiPixels = makePixels(hiW, hiH, 128);

    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 4, 3, 25);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeLessThan(15);
    }
  });

  it('produces values strictly within [0, 255]', () => {
    const lowW = 10, lowH = 10, hiW = 40, hiH = 40;
    const lowAlpha = new Uint8Array(lowW * lowH);
    const hiPixels = new Uint8ClampedArray(hiW * hiH * 4);
    for (let i = 0; i < lowW * lowH; i++) lowAlpha[i] = (i * 17 + 5) % 256;
    for (let i = 0; i < hiW * hiH; i++) {
      const off = i * 4;
      hiPixels[off] = (i * 7) % 256;
      hiPixels[off + 1] = (i * 13) % 256;
      hiPixels[off + 2] = (i * 23) % 256;
      hiPixels[off + 3] = 255;
    }

    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 3, 2, 25);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(255);
    }
  });

  it('performance: 256→1024 completes in <2s', () => {
    const lowW = 256, lowH = 256, hiW = 1024, hiH = 1024;
    const lowAlpha = new Uint8Array(lowW * lowH);
    const cx = lowW / 2, cy = lowH / 2, r = lowW / 3;
    for (let y = 0; y < lowH; y++) {
      for (let x = 0; x < lowW; x++) {
        lowAlpha[y * lowW + x] = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) < r ? 255 : 0;
      }
    }
    const hiPixels = makePixels(hiW, hiH, 150);

    const start = performance.now();
    const result = jointBilateralUpsample(lowAlpha, lowW, lowH, hiPixels, hiW, hiH, 5, 3, 25);
    const elapsed = performance.now() - start;

    expect(result.length).toBe(hiW * hiH);
    expect(elapsed).toBeLessThan(2000);
  });
});
