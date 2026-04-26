import { describe, it, expect } from 'vitest';

// happy-dom doesn't expose ImageData globally. Minimal stub for the constructor.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class ImageDataStub {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = 'srgb' as const;
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
  refineUpscaledAlpha,
} from '../../src/utils/final-composite';
import { EDGE_REFINE_PARAMS } from '../../src/pipeline/constants';

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
      100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 50, 255, 10, 10, 10, 255,
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
    const src = new Uint8ClampedArray([
      255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0,
    ]);
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

  it('runs edge refinement on the downscale path', () => {
    // 8x8 original with a vertical RGB edge at x=4 (left black, right white).
    // 4x4 working alpha with a vertical edge at working x=2 (left=0, right=255).
    // After bilinear upsample the alpha spreads into a soft ramp across the
    // boundary. refineUpscaledAlpha should push left-column α toward 0 and
    // right-column α toward 255 using the RGB edge as guide.
    const origW = 8,
      origH = 8;
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
    const workW = 4,
      workH = 4;
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

    // Left column should end up transparent, right column opaque.
    expect(out.data[3]).toBeLessThanOrEqual(EDGE_REFINE_PARAMS.BAND_LO);
    expect(out.data[(origW - 1) * 4 + 3]).toBeGreaterThanOrEqual(EDGE_REFINE_PARAMS.BAND_HI);
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
    const bottomRight = out.data.slice(15 * 4, 15 * 4 + 3);
    expect(bottomRight[0]).toBe(255);
    expect(bottomRight[2]).toBe(0);
  });
});

describe('refineUpscaledAlpha', () => {
  const makeFlatRgba = (w: number, h: number, v: number): Uint8ClampedArray => {
    const arr = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      arr[i * 4] = v;
      arr[i * 4 + 1] = v;
      arr[i * 4 + 2] = v;
      arr[i * 4 + 3] = 255;
    }
    return arr;
  };

  it('leaves all-zero alpha untouched (BAND_LO gate)', () => {
    const w = 8,
      h = 8;
    const alpha = new Uint8Array(w * h); // all 0
    const rgba = makeFlatRgba(w, h, 128);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    for (let i = 0; i < alpha.length; i++) expect(out[i]).toBe(0);
  });

  it('leaves all-255 alpha untouched (BAND_HI gate)', () => {
    const w = 8,
      h = 8;
    const alpha = new Uint8Array(w * h).fill(255);
    const rgba = makeFlatRgba(w, h, 128);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    for (let i = 0; i < alpha.length; i++) expect(out[i]).toBe(255);
  });

  it('keeps pixels outside [BAND_LO, BAND_HI] verbatim even when guide has structure', () => {
    // 4x4 with a hard vertical RGB edge in the middle.
    const w = 4,
      h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < 2 ? 0 : 255;
        const idx = (y * w + x) * 4;
        rgba[idx] = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
      }
    }
    // Alpha: all extremes (0 on left, 255 on right) — nothing in the trimap band.
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) {
      const x = i % w;
      alpha[i] = x < 2 ? 0 : 255;
    }
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    for (let i = 0; i < alpha.length; i++) expect(out[i]).toBe(alpha[i]);
  });

  it('returns the same length as input alpha', () => {
    const w = 5,
      h = 7;
    const alpha = new Uint8Array(w * h).fill(128);
    const rgba = makeFlatRgba(w, h, 200);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);
    expect(out.length).toBe(w * h);
  });

  it('sharpens a soft alpha ramp when guide has a sharp edge', () => {
    // 8x1 guide: sharp step at x=4 (left=0, right=255).
    // 8x1 alpha: smooth ramp across the whole width (simulates JBU residual).
    const w = 8,
      h = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) {
      const v = x < 4 ? 0 : 255;
      const idx = x * 4;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
    const alpha = new Uint8Array([30, 60, 90, 120, 150, 180, 210, 240]);
    const out = refineUpscaledAlpha(alpha, rgba, w, h);

    // Left half (guide=0) should be pulled DOWN toward background.
    const leftMeanIn = (alpha[1] + alpha[2] + alpha[3]) / 3;
    const leftMeanOut = (out[1] + out[2] + out[3]) / 3;
    expect(leftMeanOut).toBeLessThan(leftMeanIn);

    // Right half (guide=255) should be pulled UP toward foreground.
    const rightMeanIn = (alpha[4] + alpha[5] + alpha[6]) / 3;
    const rightMeanOut = (out[4] + out[5] + out[6]) / 3;
    expect(rightMeanOut).toBeGreaterThan(rightMeanIn);
  });

  it('does not mutate the input alpha buffer', () => {
    const w = 4,
      h = 4;
    const alpha = new Uint8Array([
      0, 0, 128, 255, 0, 64, 192, 255, 0, 96, 200, 255, 0, 128, 220, 255,
    ]);
    const snapshot = new Uint8Array(alpha);
    const rgba = makeFlatRgba(w, h, 128);
    refineUpscaledAlpha(alpha, rgba, w, h);
    expect(Array.from(alpha)).toEqual(Array.from(snapshot));
  });
});
