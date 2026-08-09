import { describe, it, expect } from 'vitest';
import { compositeWithFeather, dilateMask } from '../../src/workers/cv/inpaint-blend';

/** RGBA image filled with a solid color. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

/** Circular mask centered at (cx,cy) with radius r. */
function circleMask(w: number, h: number, cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) m[y * w + x] = 1;
    }
  }
  return m;
}

describe('dilateMask', () => {
  it('grows a single-pixel mask by the given radius', () => {
    const m = new Uint8Array(11 * 11);
    m[5 * 11 + 5] = 1; // single pixel at center
    const dilated = dilateMask(m, 11, 11, 2);
    // After dilation with r=2, a Chebyshev disk of side 5 should be set
    let count = 0;
    for (let i = 0; i < dilated.length; i++) if (dilated[i]) count++;
    expect(count).toBeGreaterThanOrEqual(13); // at least Euclidean disk r=2
    // Original pixel still set
    expect(dilated[5 * 11 + 5]).toBe(1);
    // A pixel 3 away (outside r=2) not set
    expect(dilated[5 * 11 + 8]).toBe(0);
  });

  it('is idempotent-safe: radius 0 returns identical mask', () => {
    const m = circleMask(20, 20, 10, 10, 4);
    const d = dilateMask(m, 20, 20, 0);
    expect(Array.from(d)).toEqual(Array.from(m));
  });
});

describe('compositeWithFeather', () => {
  it('leaves pixels outside the dilated mask untouched', () => {
    const w = 40,
      h = 40;
    const original = solid(w, h, 100, 150, 200);
    // Paint a different solid color into "inpainted"
    const inpainted = solid(w, h, 255, 0, 0);
    const mask = circleMask(w, h, 20, 20, 3);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 2,
      noiseSigma: 0,
    });

    // Pixel far from mask (corner) must equal original exactly
    const i = (0 * w + 0) * 4;
    expect(result[i]).toBe(100);
    expect(result[i + 1]).toBe(150);
    expect(result[i + 2]).toBe(200);
  });

  it('replaces pixels at the core of the mask with inpainted values', () => {
    const w = 40,
      h = 40;
    const original = solid(w, h, 100, 150, 200);
    const inpainted = solid(w, h, 255, 0, 0);
    const mask = circleMask(w, h, 20, 20, 6);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 2,
      noiseSigma: 0,
    });

    // Center of mask should be fully inpainted (allowing ±1 for integer blend rounding)
    const i = (20 * w + 20) * 4;
    expect(result[i]).toBeGreaterThan(250);
    expect(result[i + 1]).toBeLessThan(5);
    expect(result[i + 2]).toBeLessThan(5);
  });

  it('produces intermediate blend values in the feather ring', () => {
    const w = 60,
      h = 60;
    const original = solid(w, h, 0, 0, 0);
    const inpainted = solid(w, h, 200, 200, 200);
    const mask = circleMask(w, h, 30, 30, 8);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 4,
      noiseSigma: 0,
    });

    // Pixel just outside the mask but inside the feather: should be blended
    const i = (30 * w + (30 + 9)) * 4; // 1px outside mask radius
    expect(result[i]).toBeGreaterThan(0);
    expect(result[i]).toBeLessThan(200);
  });

  it('preserves alpha channel at 255 everywhere', () => {
    const w = 30,
      h = 30;
    const original = solid(w, h, 50, 50, 50);
    const inpainted = solid(w, h, 150, 150, 150);
    const mask = circleMask(w, h, 15, 15, 4);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 2,
      noiseSigma: 0,
    });

    for (let i = 3; i < result.length; i += 4) {
      expect(result[i]).toBe(255);
    }
  });

  it('injects noise inside the mask when noiseSigma > 0', () => {
    const w = 40,
      h = 40;
    const original = solid(w, h, 100, 100, 100);
    const inpainted = solid(w, h, 100, 100, 100); // identical to original
    const mask = circleMask(w, h, 20, 20, 6);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 2,
      noiseSigma: 8,
    });

    // With noise, pixels inside mask should NOT all be exactly 100
    let varied = 0;
    const r2 = 4 * 4; // sample near core
    for (let y = 16; y <= 24; y++) {
      for (let x = 16; x <= 24; x++) {
        const dx = x - 20,
          dy = y - 20;
        if (dx * dx + dy * dy > r2) continue;
        const i = (y * w + x) * 4;
        if (result[i] !== 100) varied++;
      }
    }
    expect(varied).toBeGreaterThan(5);
  });

  it('does not add noise outside the mask', () => {
    const w = 40,
      h = 40;
    const original = solid(w, h, 100, 100, 100);
    const inpainted = solid(w, h, 100, 100, 100);
    const mask = circleMask(w, h, 20, 20, 4);

    const result = compositeWithFeather(original, inpainted, mask, w, h, {
      featherRadius: 1,
      noiseSigma: 20,
    });

    // Corner pixel, far from mask, must remain exactly 100
    const i = (0 * w + 0) * 4;
    expect(result[i]).toBe(100);
    expect(result[i + 1]).toBe(100);
    expect(result[i + 2]).toBe(100);
  });
});
