import { describe, it, expect } from 'vitest';
import { sharpenAlpha, refineEdges } from '../../src/pipeline/finalize';

// ImageData polyfill for happy-dom (see tests/components/ar-editor.test.ts).
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, maybeHeight?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? (dataOrWidth.length / (widthOrHeight * 4));
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

describe('sharpenAlpha (narrow-band smoothstep [100, 160])', () => {
  it('preserves the 0 and 255 endpoints exactly', () => {
    const a = new Uint8Array([0, 255, 0, 255]);
    const out = sharpenAlpha(a);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });

  it('clamps everything below the LOW bound to 0 (kills halo)', () => {
    const out = sharpenAlpha(new Uint8Array([1, 30, 60, 99, 100]));
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
  });

  it('clamps everything above the HIGH bound to 255 (tight interior)', () => {
    const out = sharpenAlpha(new Uint8Array([160, 170, 200, 230, 254]));
    expect(Array.from(out)).toEqual([255, 255, 255, 255, 255]);
  });

  it('smooths the narrow band [100, 160] through a smoothstep', () => {
    const out = sharpenAlpha(new Uint8Array([100, 115, 130, 145, 160]));
    // 100 → 0, 160 → 255, 130 ≈ 128 (midpoint of smoothstep)
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
    expect(Math.abs(out[2] - 128)).toBeLessThanOrEqual(2);
    // smoothstep endpoints have zero slope, so 115 and 145 are pushed
    // toward their nearer endpoint rather than landing linearly at 64/192
    expect(out[1]).toBeLessThan(64);
    expect(out[3]).toBeGreaterThan(192);
  });

  it('is monotonic across the full 0..255 range', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const out = sharpenAlpha(input);
    for (let i = 1; i < 256; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
    }
  });

  it('produces a narrow soft band: only ~60 input values map to soft α', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const out = sharpenAlpha(input);
    const soft = Array.from(out).filter((v) => v > 0 && v < 255).length;
    // Band is [100, 160] exclusive endpoints, minus rounding to 0 or 255
    // near the tails — expect somewhere in [40, 60] soft values.
    expect(soft).toBeGreaterThan(35);
    expect(soft).toBeLessThan(65);
  });
});

describe('refineEdges', () => {
  it('without pipeline: RGB is untouched, α is sharpened', async () => {
    const w = 4, h = 1;
    const data = new Uint8ClampedArray(w * h * 4);
    // One opaque, two soft, one transparent
    data.set([255, 0, 0, 255,   100, 100, 100, 30,   50, 50, 50, 200,   0, 0, 0, 0]);
    const img = new ImageData(data, w, h);

    const out = await refineEdges(null, img);

    // RGB preserved for all pixels
    for (let i = 0; i < w * h; i++) {
      expect(out.data[i * 4]).toBe(data[i * 4]);
      expect(out.data[i * 4 + 1]).toBe(data[i * 4 + 1]);
      expect(out.data[i * 4 + 2]).toBe(data[i * 4 + 2]);
    }

    // α=30 collapses to near-0, α=200 pushes toward ~231
    expect(out.data[7]).toBeLessThan(5);          // was 30
    expect(out.data[11]).toBeGreaterThan(215);    // was 200
    expect(out.data[3]).toBe(255);                // opaque endpoint
    expect(out.data[15]).toBe(0);                 // transparent endpoint
  });

  it('with pipeline: delegates decontamination to estimateForeground', async () => {
    const w = 2, h = 1;
    const data = new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 200]);
    const img = new ImageData(data, w, h);

    // Stub pipeline: returns a marker RGB (99, 99, 99) so we can detect it ran.
    const calls: Array<{ w: number; h: number; alphaSample: number }> = [];
    const stub = {
      estimateForeground: async (
        _pixels: Uint8ClampedArray,
        alpha: Uint8Array,
        width: number,
        height: number,
      ): Promise<Uint8ClampedArray> => {
        calls.push({ w: width, h: height, alphaSample: alpha[0] });
        const out = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          out[i * 4] = 99;
          out[i * 4 + 1] = 99;
          out[i * 4 + 2] = 99;
          out[i * 4 + 3] = alpha[i];
        }
        return out;
      },
    };

    const out = await refineEdges(stub, img);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ w: 2, h: 1, alphaSample: 128 });
    // RGB should be the stubbed 99s (proving estimateForeground was used).
    expect(out.data[0]).toBe(99);
    expect(out.data[4]).toBe(99);
  });

  it('returns a fresh ImageData (does not mutate input)', async () => {
    const w = 2, h = 1;
    const data = new Uint8ClampedArray([10, 20, 30, 50, 40, 50, 60, 150]);
    const img = new ImageData(data, w, h);
    const snapshot = Array.from(data);

    await refineEdges(null, img);

    expect(Array.from(img.data)).toEqual(snapshot);
  });
});
