import { describe, it, expect } from 'vitest';

// happy-dom doesn't expose ImageData globally. Minimal stub for the constructor.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class ImageDataStub {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: 'srgb' = 'srgb';
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as { ImageData?: unknown }).ImageData = ImageDataStub;
}

import {
  bilinearUpscaleU8,
  bilinearUpscaleRGB,
  composeAtOriginal,
} from '../../src/utils/final-composite';

describe('bilinearUpscaleU8', () => {
  it('returns a copy when sizes match', () => {
    const src = new Uint8Array([10, 20, 30, 40]);
    const out = bilinearUpscaleU8(src, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
    // should be a copy, not same ref
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
    // middle of the top row should interpolate between 0 and 255
    const midTop = out[1];
    expect(midTop).toBeGreaterThan(0);
    expect(midTop).toBeLessThan(255);
  });

  it('handles downscale target gracefully (output size fixed)', () => {
    const src = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const out = bilinearUpscaleU8(src, 3, 3, 2, 2);
    expect(out.length).toBe(4);
  });
});

describe('bilinearUpscaleRGB', () => {
  it('preserves corner RGB when upscaling 2x2 to 4x4', () => {
    // Pixel (0,0) red=100, (1,0) green=200, (0,1) blue=50, (1,1) gray=10
    const src = new Uint8ClampedArray([
      100, 0, 0, 255,    0, 200, 0, 255,
      0, 0, 50, 255,    10, 10, 10, 255,
    ]);
    const out = bilinearUpscaleRGB(src, 2, 2, 4, 4);
    // Top-left: (100, 0, 0)
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    // Top-right: (0, 200, 0)
    expect(out[12]).toBe(0);
    expect(out[13]).toBe(200);
    expect(out[14]).toBe(0);
  });

  it('forces alpha=255 in output', () => {
    const src = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 0,
                                        255, 255, 255, 0, 255, 255, 255, 0]);
    const out = bilinearUpscaleRGB(src, 2, 2, 4, 4);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i + 3]).toBe(255);
    }
  });
});

describe('composeAtOriginal', () => {
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

  it('fast-path when working size equals original size', () => {
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
    // Alpha channel matches input alpha
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(128);
    expect(out.data[11]).toBe(255);
    expect(out.data[15]).toBe(64);
  });

  it('composes RGB from pristine original when no inpaint mask', () => {
    // Original: full red at 4x4. Working: "modified" to green at 2x2 (as if pipeline touched it).
    // Without inpaint mask, the composite should keep the pristine red from the original.
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
    // Every pixel should still be red (pristine original preserved)
    for (let i = 0; i < 16; i++) {
      expect(out.data[i * 4]).toBe(255);
      expect(out.data[i * 4 + 1]).toBe(0);
      expect(out.data[i * 4 + 2]).toBe(0);
      // Alpha: upscaled from all-255
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it('applies upscaled alpha at original resolution', () => {
    const original = makeRgba(4, 4, [128, 128, 128]);
    const working = makeRgba(2, 2, [128, 128, 128]);
    // Working alpha: top row opaque, bottom row transparent
    const alpha = new Uint8Array([255, 255, 0, 0]);
    const out = composeAtOriginal({
      originalRgba: original,
      originalWidth: 4,
      originalHeight: 4,
      workingRgba: working,
      workingWidth: 2,
      workingHeight: 2,
      workingAlpha: alpha,
    });
    // Top-left: 255 alpha
    expect(out.data[3]).toBe(255);
    // Bottom-left (row 3, col 0, index 12): 0 alpha
    expect(out.data[(3 * 4 + 0) * 4 + 3]).toBe(0);
  });

  it('blends inpainted RGB into masked region', () => {
    const original = makeRgba(4, 4, [255, 0, 0]); // pristine red
    const working = makeRgba(2, 2, [0, 0, 255]); // "inpainted" blue
    const alpha = new Uint8Array([255, 255, 255, 255]);
    // Inpaint mask: only top-left working pixel was inpainted
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
    // Top-left of output should be biased toward blue (inpainted).
    // Bottom-right of output should still be pristine red (mask=0 there).
    const topLeft = out.data.slice(0, 3);
    expect(topLeft[2]).toBeGreaterThan(topLeft[0]);
    const bottomRight = out.data.slice((15) * 4, (15) * 4 + 3);
    expect(bottomRight[0]).toBe(255);
    expect(bottomRight[2]).toBe(0);
  });
});
