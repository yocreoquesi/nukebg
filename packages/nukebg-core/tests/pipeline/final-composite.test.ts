import { describe, it, expect } from 'vitest';
import {
  bilinearUpscaleU8,
  bilinearUpscaleRGB,
  composeAtOriginal,
  refineUpscaledAlpha,
} from '../../src/pipeline/final-composite';
import { EDGE_REFINE_PARAMS } from '../../src/pipeline/constants';

// Core runs in Node — NO ImageData global, NO polyfill.
// All inputs are constructed as plain objects; outputs are asserted as plain ImageDataLike.

// ── REQ-CORE-PIPELINE-2 compliance ──

describe('composeAtOriginal — returns plain ImageDataLike (not ImageData instance)', () => {
  const makeRgba = (w: number, h: number, fill: [number, number, number]): Uint8ClampedArray => {
    const arr = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      arr[i * 4] = fill[0];
      arr[i * 4 + 1] = fill[1];
      arr[i * 4 + 2] = fill[2];
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  it('fast-path return value satisfies ImageDataLike (has data, width, height)', () => {
    const original = makeRgba(2, 2, [100, 50, 10]);
    const working = makeRgba(2, 2, [100, 50, 10]);
    const alpha = new Uint8Array([0, 128, 255, 64]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 2,
      originalHeight: 2,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width', 2);
    expect(out).toHaveProperty('height', 2);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('fast-path return value is NOT an ImageData instance (plain object)', () => {
    const original = makeRgba(2, 2, [100, 50, 10]);
    const working = makeRgba(2, 2, [100, 50, 10]);
    const alpha = new Uint8Array([0, 128, 255, 64]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 2,
      originalHeight: 2,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    // Plain object: prototype is Object.prototype, not ImageData.prototype
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('downscale-path return value satisfies ImageDataLike (has data, width, height)', () => {
    const original = makeRgba(4, 4, [200, 100, 50]);
    const working = makeRgba(2, 2, [200, 100, 50]);
    const alpha = new Uint8Array([255, 255, 255, 255]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 4,
      originalHeight: 4,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width', 4);
    expect(out).toHaveProperty('height', 4);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('downscale-path return value is NOT an ImageData instance (plain object)', () => {
    const original = makeRgba(4, 4, [200, 100, 50]);
    const working = makeRgba(2, 2, [200, 100, 50]);
    const alpha = new Uint8Array([255, 255, 255, 255]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 4,
      originalHeight: 4,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

// ── Behavioural tests ──

describe('bilinearUpscaleU8 (core)', () => {
  it('returns a copy when sizes match', () => {
    const src = new Uint8Array([10, 20, 30, 40]);
    const out = bilinearUpscaleU8(src, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
    expect(out).not.toBe(src);
  });

  it('preserves corner values when upscaling 2x2 to 4x4', () => {
    const src = new Uint8Array([0, 255, 255, 0]);
    const out = bilinearUpscaleU8(src, 2, 2, 4, 4);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
    expect(out[12]).toBe(255);
    expect(out[15]).toBe(0);
  });

  it('produces smooth values in between corners', () => {
    const src = new Uint8Array([0, 255, 0, 255]);
    const out = bilinearUpscaleU8(src, 2, 2, 4, 4);
    const midTop = out[1] ?? 0;
    expect(midTop).toBeGreaterThan(0);
    expect(midTop).toBeLessThan(255);
  });
});

describe('bilinearUpscaleRGB (core)', () => {
  it('preserves corner RGB when upscaling 2x2 to 4x4', () => {
    const src = new Uint8ClampedArray([
      100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 50, 255, 10, 10, 10, 255,
    ]);
    const out = bilinearUpscaleRGB(src, 2, 2, 4, 4);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[12]).toBe(0);
    expect(out[13]).toBe(200);
    expect(out[14]).toBe(0);
  });

  it('forces alpha=255 in output', () => {
    const src = new Uint8ClampedArray([
      255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0,
    ]);
    const out = bilinearUpscaleRGB(src, 2, 2, 4, 4);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i + 3]).toBe(255);
    }
  });
});

describe('composeAtOriginal (core)', () => {
  const makeRgba = (w: number, h: number, fill: [number, number, number]): Uint8ClampedArray => {
    const arr = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      arr[i * 4] = fill[0];
      arr[i * 4 + 1] = fill[1];
      arr[i * 4 + 2] = fill[2];
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  it('fast-path when working size equals original size — alpha matches', () => {
    const original = makeRgba(2, 2, [100, 50, 10]);
    const working = makeRgba(2, 2, [100, 50, 10]);
    const alpha = new Uint8Array([0, 128, 255, 64]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 2,
      originalHeight: 2,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(128);
    expect(out.data[11]).toBe(255);
    expect(out.data[15]).toBe(64);
  });

  it('composes RGB from pristine original when no inpaint mask', () => {
    const original = makeRgba(4, 4, [255, 0, 0]);
    const working = makeRgba(2, 2, [0, 255, 0]);
    const alpha = new Uint8Array([255, 255, 255, 255]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 4,
      originalHeight: 4,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    for (let i = 0; i < 16; i++) {
      expect(out.data[i * 4]).toBe(255);
      expect(out.data[i * 4 + 1]).toBe(0);
      expect(out.data[i * 4 + 2]).toBe(0);
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it('runs edge refinement on the downscale path', () => {
    const origW = 8, origH = 8;
    const original = new Uint8ClampedArray(origW * origH * 4);
    for (let y = 0; y < origH; y++) {
      for (let x = 0; x < origW; x++) {
        const idx = (y * origW + x) * 4;
        const v = x < 4 ? 0 : 255;
        original[idx] = v;
        original[idx + 1] = v;
        original[idx + 2] = v;
        original[idx + 3] = 255;
      }
    }
    const workW = 4, workH = 4;
    const working = new Uint8ClampedArray(workW * workH * 4);
    const workAlpha = new Uint8Array(workW * workH);
    for (let i = 0; i < workAlpha.length; i++) {
      const x = i % workW;
      workAlpha[i] = x < 2 ? 0 : 255;
    }
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: origW,
      originalHeight: origH,
      workingRgba: working,
      workingWidth: workW,
      workingHeight: workH,
      workingAlpha: workAlpha,
    });
    expect(out.data[3]).toBeLessThanOrEqual(EDGE_REFINE_PARAMS.BAND_LO);
    expect(out.data[(origW - 1) * 4 + 3]).toBeGreaterThanOrEqual(EDGE_REFINE_PARAMS.BAND_HI);
  });

  it('blends inpainted RGB into masked region', () => {
    const original = makeRgba(4, 4, [255, 0, 0]);
    const working = makeRgba(2, 2, [0, 0, 255]);
    const alpha = new Uint8Array([255, 255, 255, 255]);
    const mask = new Uint8Array([1, 0, 0, 0]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 4,
      originalHeight: 4,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
      inpaintMask: mask,
    });
    const topLeft = out.data.slice(0, 3);
    expect(topLeft[2]).toBeGreaterThan(topLeft[0] ?? 0);
    const bottomRight = out.data.slice(15 * 4, 15 * 4 + 3);
    expect(bottomRight[0]).toBe(255);
    expect(bottomRight[2]).toBe(0);
  });
});

describe('refineUpscaledAlpha (core)', () => {
  const makeFlatRgba = (w: number, h: number, v: number): Uint8ClampedArray => {
    const arr = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      arr[i * 4] = v; arr[i * 4 + 1] = v;
      arr[i * 4 + 2] = v; arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  it('leaves all-zero alpha untouched (BAND_LO gate)', () => {
    const w = 8, h = 8;
    const alpha = new Uint8Array(w * h);
    const rgba = makeFlatRgba(w, h, 128);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    for (let i = 0; i < alpha.length; i++) expect(out[i]).toBe(0);
  });

  it('leaves all-255 alpha untouched (BAND_HI gate)', () => {
    const w = 8, h = 8;
    const alpha = new Uint8Array(w * h).fill(255);
    const rgba = makeFlatRgba(w, h, 128);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    for (let i = 0; i < alpha.length; i++) expect(out[i]).toBe(255);
  });

  it('returns the same length as input alpha', () => {
    const w = 5, h = 7;
    const alpha = new Uint8Array(w * h).fill(128);
    const rgba = makeFlatRgba(w, h, 200);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    expect(out.length).toBe(w * h);
  });
});
