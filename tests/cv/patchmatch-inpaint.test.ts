import { describe, it, expect } from 'vitest';
import {
  patchDistance,
  initNNF,
  patchMatchInpaint,
} from '../../src/workers/cv/patchmatch-inpaint';

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

/** Image with a vertical stripe pattern (each column shifts hue). */
function stripes(w: number, h: number, period: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const phase = Math.floor(x / period) % 2;
      const g = phase ? 200 : 50;
      const i = (y * w + x) * 4;
      out[i] = g;
      out[i + 1] = g;
      out[i + 2] = g;
      out[i + 3] = 255;
    }
  }
  return out;
}

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

describe('patchDistance', () => {
  it('returns 0 for identical patches', () => {
    const img = solid(10, 10, 100, 100, 100);
    const d = patchDistance(img, img, 10, 10, 5, 5, 5, 5, 3);
    expect(d).toBe(0);
  });

  it('increases monotonically with color difference', () => {
    const a = solid(10, 10, 100, 100, 100);
    const b1 = solid(10, 10, 110, 110, 110);
    const b2 = solid(10, 10, 150, 150, 150);
    const d1 = patchDistance(a, b1, 10, 10, 5, 5, 5, 5, 3);
    const d2 = patchDistance(a, b2, 10, 10, 5, 5, 5, 5, 3);
    expect(d2).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(0);
  });
});

describe('initNNF', () => {
  it('produces valid source coordinates for each target pixel', () => {
    const w = 20, h = 20;
    const mask = circleMask(w, h, 10, 10, 3);
    const nnf = initNNF(w, h, mask, 3);
    expect(nnf.length).toBe(w * h * 2);
    // For each masked pixel, source should be outside mask and fit patch window
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const sx = nnf[(y * w + x) * 2];
        const sy = nnf[(y * w + x) * 2 + 1];
        // Source must fit a 3-radius patch inside the image
        expect(sx).toBeGreaterThanOrEqual(3);
        expect(sx).toBeLessThan(w - 3);
        expect(sy).toBeGreaterThanOrEqual(3);
        expect(sy).toBeLessThan(h - 3);
        // Source pixel must not itself be masked
        expect(mask[sy * w + sx]).toBe(0);
      }
    }
  });
});

describe('patchMatchInpaint', () => {
  it('does not modify pixels outside the mask', () => {
    const w = 32, h = 32;
    const src = stripes(w, h, 4);
    const mask = circleMask(w, h, 16, 16, 3);
    const out = patchMatchInpaint(src, w, h, mask, { iterations: 2, patchRadius: 3 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        const i = (y * w + x) * 4;
        expect(out[i]).toBe(src[i]);
        expect(out[i + 1]).toBe(src[i + 1]);
        expect(out[i + 2]).toBe(src[i + 2]);
      }
    }
  });

  it('fills a uniform-color mask with the same color', () => {
    const w = 40, h = 40;
    const src = solid(w, h, 140, 80, 40);
    const mask = circleMask(w, h, 20, 20, 5);
    const out = patchMatchInpaint(src, w, h, mask, { iterations: 2, patchRadius: 3 });
    // All masked pixels should be very close to the uniform source color
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const i = (y * w + x) * 4;
        expect(Math.abs(out[i] - 140)).toBeLessThanOrEqual(2);
        expect(Math.abs(out[i + 1] - 80)).toBeLessThanOrEqual(2);
        expect(Math.abs(out[i + 2] - 40)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('reconstructs a striped pattern consistently (structure + texture)', () => {
    const w = 48, h = 48;
    const period = 4;
    const src = stripes(w, h, period);
    // Small square mask in the middle
    const mask = new Uint8Array(w * h);
    for (let y = 20; y < 28; y++) {
      for (let x = 20; x < 28; x++) mask[y * w + x] = 1;
    }
    const out = patchMatchInpaint(src, w, h, mask, { iterations: 4, patchRadius: 3 });
    // The reconstructed patch should be close to pure stripe values (50 or 200),
    // not a flat grey (which would indicate blur/averaging). Count how many
    // masked pixels are within 30 of either stripe extreme.
    let crisp = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        total++;
        const i = (y * w + x) * 4;
        if (out[i] < 80 || out[i] > 170) crisp++;
      }
    }
    // At least 70% of reconstructed pixels should be crisp (not midtone mush)
    expect(crisp / total).toBeGreaterThan(0.70);
  });

  it('preserves the alpha channel at 255 in the mask region', () => {
    const w = 30, h = 30;
    const src = solid(w, h, 100, 100, 100);
    const mask = circleMask(w, h, 15, 15, 4);
    const out = patchMatchInpaint(src, w, h, mask, { iterations: 2, patchRadius: 3 });
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i]).toBe(255);
    }
  });

  it('respects a search region restriction (no source patches from forbidden zone)', () => {
    const w = 60, h = 60;
    // Left half is red, right half is blue. Mask is in the center column.
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = x < 30 ? 200 : 20;
        pixels[i + 1] = 20;
        pixels[i + 2] = x < 30 ? 20 : 200;
        pixels[i + 3] = 255;
      }
    }
    // Mask in the blue side
    const mask = circleMask(w, h, 45, 30, 4);
    // Force source region to the blue side only (right half)
    const searchRegion = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 30; x < w; x++) {
        if (!mask[y * w + x]) searchRegion[y * w + x] = 1;
      }
    }
    const out = patchMatchInpaint(pixels, w, h, mask, {
      iterations: 4,
      patchRadius: 2,
      searchRegion,
    });
    // Reconstructed pixels should be blue (not red pulled from the left side)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const i = (y * w + x) * 4;
        expect(out[i]).toBeLessThan(80); // red channel stays low
        expect(out[i + 2]).toBeGreaterThan(120); // blue channel stays high
      }
    }
  });
});
