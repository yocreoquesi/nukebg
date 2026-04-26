import { describe, it, expect } from 'vitest';
import {
  computeLamaCropRect,
  bilinearResizeRGBA,
  nearestResizeMask,
  spliceLamaOutput,
} from '../../src/workers/cv/lama-crop';
import { LAMA_PARAMS } from '../../src/pipeline/constants';

function makeMask(
  w: number,
  h: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      m[y * w + x] = 1;
    }
  }
  return m;
}

function solidRgba(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

describe('computeLamaCropRect', () => {
  it('returns null for an empty mask', () => {
    const rect = computeLamaCropRect(new Uint8Array(10 * 10), 10, 10);
    expect(rect).toBeNull();
  });

  it('produces a square crop (w === h)', () => {
    const w = 400,
      h = 300;
    const mask = makeMask(w, h, 50, 40, 30, 60); // non-square bbox
    const rect = computeLamaCropRect(mask, w, h)!;
    expect(rect).not.toBeNull();
    expect(rect.w).toBe(rect.h);
  });

  it('enforces MIN_CROP_SIDE when the mask bbox is tiny', () => {
    const w = 512,
      h = 512;
    const mask = makeMask(w, h, 100, 100, 4, 4);
    const rect = computeLamaCropRect(mask, w, h)!;
    expect(rect.w).toBeGreaterThanOrEqual(LAMA_PARAMS.MIN_CROP_SIDE);
  });

  it('clamps the crop inside the image bounds', () => {
    const w = 200,
      h = 200;
    // Mask at the bottom-right corner — crop must not overflow.
    const mask = makeMask(w, h, 180, 180, 10, 10);
    const rect = computeLamaCropRect(mask, w, h)!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(w);
    expect(rect.y + rect.h).toBeLessThanOrEqual(h);
  });

  it('never returns a crop bigger than min(width, height)', () => {
    const w = 80,
      h = 600;
    const mask = makeMask(w, h, 10, 100, 60, 400); // very tall bbox
    const rect = computeLamaCropRect(mask, w, h)!;
    expect(rect.w).toBeLessThanOrEqual(Math.min(w, h));
    expect(rect.h).toBeLessThanOrEqual(Math.min(w, h));
  });

  it('centres the square on the mask bbox midpoint when there is room', () => {
    const w = 1000,
      h = 1000;
    const mask = makeMask(w, h, 450, 450, 100, 100); // centred mask
    const rect = computeLamaCropRect(mask, w, h)!;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    expect(Math.abs(cx - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - 500)).toBeLessThanOrEqual(1);
  });
});

describe('bilinearResizeRGBA', () => {
  it('resizing a solid colour preserves that colour exactly', () => {
    const w = 200,
      h = 200;
    const src = solidRgba(w, h, 120, 80, 200);
    const rect = { x: 50, y: 50, w: 100, h: 100 };
    const out = bilinearResizeRGBA(src, w, rect, 64);
    expect(out.length).toBe(64 * 64 * 4);
    // Sample a few interior pixels.
    for (const [ox, oy] of [
      [0, 0],
      [32, 32],
      [63, 63],
    ]) {
      const i = (oy * 64 + ox) * 4;
      expect(out[i]).toBe(120);
      expect(out[i + 1]).toBe(80);
      expect(out[i + 2]).toBe(200);
      expect(out[i + 3]).toBe(255);
    }
  });
});

describe('nearestResizeMask', () => {
  it('output is strictly binary {0,1}', () => {
    const w = 50,
      h = 50;
    const mask = makeMask(w, h, 10, 10, 30, 30);
    const rect = { x: 0, y: 0, w, h };
    const out = nearestResizeMask(mask, w, rect, 32);
    for (let i = 0; i < out.length; i++) {
      expect(out[i] === 0 || out[i] === 1).toBe(true);
    }
  });

  it('a fully-covered mask resizes to a fully-covered mask', () => {
    const w = 32,
      h = 32;
    const mask = new Uint8Array(w * h).fill(1);
    const rect = { x: 0, y: 0, w, h };
    const out = nearestResizeMask(mask, w, rect, 64);
    expect(out.every((v) => v === 1)).toBe(true);
  });
});

describe('spliceLamaOutput', () => {
  it('overwrites only the crop rectangle and leaves the rest untouched', () => {
    const baseW = 100,
      baseH = 100;
    const base = solidRgba(baseW, baseH, 10, 20, 30);
    // LaMa output: solid red at model resolution.
    const lamaSize = 64;
    const lamaOut = solidRgba(lamaSize, lamaSize, 255, 0, 0);
    const rect = { x: 20, y: 20, w: 40, h: 40 };

    const out = spliceLamaOutput(base, baseW, baseH, lamaOut, lamaSize, rect);

    // Inside the rect — red.
    const insideI = (30 * baseW + 30) * 4;
    expect(out[insideI]).toBeGreaterThan(200);
    expect(out[insideI + 1]).toBeLessThan(30);

    // Outside the rect — original grey.
    const outsideI = (5 * baseW + 5) * 4;
    expect(out[outsideI]).toBe(10);
    expect(out[outsideI + 1]).toBe(20);
    expect(out[outsideI + 2]).toBe(30);

    // Alpha of destination preserved — base was fully opaque.
    expect(out[insideI + 3]).toBe(255);
    expect(out[outsideI + 3]).toBe(255);
  });
});
