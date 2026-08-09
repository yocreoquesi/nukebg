import { describe, it, expect } from 'vitest';
import {
  sharpenAlpha,
  refineEdges,
  keepLargestComponent,
  tailLuminanceVariance,
  hasHaloRisk,
  dropOrphanBlobs,
  fillSubjectHoles,
  promoteSpeckleAlpha,
} from '../../src/pipeline/finalize';
import type { ImageDataLike } from '../../src/types/image-data-like';
import { createImageDataLike } from '../../src/types/image-data-like';

// Core runs in Node — NO ImageData global, NO polyfill.
// All tests construct plain objects satisfying ImageDataLike directly.

function makeImage(data: Uint8ClampedArray, width: number, height: number): ImageDataLike {
  return createImageDataLike(data, width, height);
}

// ── REQ-CORE-PIPELINE-2 compliance: each function must return a plain ImageDataLike ──

describe('fillSubjectHoles — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract', () => {
    const data = new Uint8ClampedArray(7 * 7 * 4).fill(255);
    // create an interior hole
    data[(3 * 7 + 3) * 4 + 3] = 0;
    const img = makeImage(data, 7, 7);
    const out = fillSubjectHoles(img);
    // must have data, width, height
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width');
    expect(out).toHaveProperty('height');
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(out.width).toBe(7);
    expect(out.height).toBe(7);
  });

  it('return value is NOT an ImageData instance (plain object)', () => {
    const data = new Uint8ClampedArray(7 * 7 * 4).fill(255);
    const img = makeImage(data, 7, 7);
    const out = fillSubjectHoles(img);
    // In core there is no ImageData constructor — object must be plain
    // Verify it is a plain object (constructor is Object or similar, not ImageData)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('dropOrphanBlobs — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract', () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    // main blob
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) data[(y * 5 + x) * 4 + 3] = 255;
    // stray pixel
    data[(4 * 5 + 4) * 4 + 3] = 128;
    const img = makeImage(data, 5, 5);
    const out = dropOrphanBlobs(img);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width');
    expect(out).toHaveProperty('height');
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(out.width).toBe(5);
    expect(out.height).toBe(5);
  });

  it('return value is NOT an ImageData instance (plain object)', () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    for (let i = 0; i < 25; i++) data[i * 4 + 3] = 255;
    const img = makeImage(data, 5, 5);
    const out = dropOrphanBlobs(img);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('promoteSpeckleAlpha — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract', () => {
    const data = new Uint8ClampedArray(9 * 9 * 4).fill(255);
    // speck at center
    data[(4 * 9 + 4) * 4 + 3] = 150;
    const img = makeImage(data, 9, 9);
    const out = promoteSpeckleAlpha(img);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width');
    expect(out).toHaveProperty('height');
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(out.width).toBe(9);
    expect(out.height).toBe(9);
  });

  it('return value is NOT an ImageData instance (plain object)', () => {
    const data = new Uint8ClampedArray(9 * 9 * 4).fill(255);
    const img = makeImage(data, 9, 9);
    const out = promoteSpeckleAlpha(img);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('refineEdges — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract', async () => {
    const w = 4, h = 1;
    const data = new Uint8ClampedArray([255, 0, 0, 255, 100, 100, 100, 200, 50, 50, 50, 30, 0, 0, 0, 0]);
    const img = makeImage(data, w, h);
    const out = await refineEdges(null, img);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width');
    expect(out).toHaveProperty('height');
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(out.width).toBe(w);
    expect(out.height).toBe(h);
  });

  it('return value is NOT an ImageData instance (plain object)', async () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
    const img = makeImage(data, 2, 1);
    const out = await refineEdges(null, img);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

// ── Behavioural tests (ported from app, using plain ImageDataLike inputs) ──

describe('sharpenAlpha (smoothstep [80, 180])', () => {
  it('preserves the 0 and 255 endpoints exactly', () => {
    const a = new Uint8Array([0, 255, 0, 255]);
    const out = sharpenAlpha(a);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });

  it('clamps everything below the LOW bound to 0 (kills halo)', () => {
    const out = sharpenAlpha(new Uint8Array([1, 20, 40, 60, 80]));
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
  });

  it('clamps everything above the HIGH bound to 255 (opaque interior)', () => {
    const out = sharpenAlpha(new Uint8Array([180, 200, 220, 240, 254]));
    expect(Array.from(out)).toEqual([255, 255, 255, 255, 255]);
  });

  it('smooths the soft band [80, 180] through a smoothstep', () => {
    const out = sharpenAlpha(new Uint8Array([80, 105, 130, 155, 180]));
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
    expect(Math.abs((out[2] ?? 0) - 128)).toBeLessThanOrEqual(4);
    expect(out[1]).toBeLessThan(64);
    expect(out[3]).toBeGreaterThan(192);
  });

  it('is monotonic across the full 0..255 range', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const out = sharpenAlpha(input);
    for (let i = 1; i < 256; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] ?? 0);
    }
  });
});

describe('refineEdges (core)', () => {
  it('without pipeline: RGB is untouched, α is sharpened', async () => {
    const w = 4, h = 1;
    const data = new Uint8ClampedArray(w * h * 4);
    data.set([255, 0, 0, 255, 100, 100, 100, 200, 50, 50, 50, 30, 0, 0, 0, 0]);
    const img = makeImage(data, w, h);
    const out = await refineEdges(null, img);

    for (let i = 0; i < w * h; i++) {
      expect(out.data[i * 4]).toBe(data[i * 4]);
      expect(out.data[i * 4 + 1]).toBe(data[i * 4 + 1]);
      expect(out.data[i * 4 + 2]).toBe(data[i * 4 + 2]);
    }
    expect(out.data[3]).toBe(255);
    expect(out.data[7]).toBeGreaterThan(215);
    expect(out.data[11]).toBeLessThan(5);
    expect(out.data[15]).toBe(0);
  });

  it('returns a fresh ImageDataLike (does not mutate input)', async () => {
    const w = 2, h = 1;
    const data = new Uint8ClampedArray([10, 20, 30, 50, 40, 50, 60, 150]);
    const img = makeImage(data, w, h);
    const snapshot = Array.from(data);
    await refineEdges(null, img);
    expect(Array.from(img.data)).toEqual(snapshot);
  });
});

describe('tailLuminanceVariance / hasHaloRisk (core)', () => {
  const makeFrame = (
    tailCount: number,
    tailRgb: (i: number) => [number, number, number],
    tailAlpha: number = 60,
  ): { rgba: Uint8ClampedArray; alpha: Uint8Array } => {
    const n = Math.max(tailCount + 200, 400);
    const rgba = new Uint8ClampedArray(n * 4);
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (i < tailCount) {
        const [r, g, b] = tailRgb(i);
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = tailAlpha;
        alpha[i] = tailAlpha;
      } else if (i < tailCount + 100) {
        rgba[i * 4 + 3] = 255;
        alpha[i] = 255;
      } else {
        alpha[i] = 0;
      }
    }
    return { rgba, alpha };
  };

  it('returns Infinity (safe) when the tail has fewer than 100 samples', () => {
    const { rgba, alpha } = makeFrame(50, () => [100, 100, 100]);
    expect(tailLuminanceVariance(rgba, alpha)).toBe(Infinity);
    expect(hasHaloRisk(rgba, alpha)).toBe(false);
  });

  it('flags a uniform flat background (low variance) as halo risk', () => {
    const { rgba, alpha } = makeFrame(300, () => [120, 120, 120]);
    const v = tailLuminanceVariance(rgba, alpha);
    expect(v).toBeLessThan(1);
    expect(hasHaloRisk(rgba, alpha)).toBe(true);
  });

  it('passes a textured background (high variance) as safe to refine', () => {
    const { rgba, alpha } = makeFrame(300, (i) => {
      const v = (i * 37) % 256;
      return [v, v, v];
    });
    const v = tailLuminanceVariance(rgba, alpha);
    expect(v).toBeGreaterThan(1000);
    expect(hasHaloRisk(rgba, alpha)).toBe(false);
  });
});

describe('dropOrphanBlobs (core)', () => {
  it('zeros α on disconnected blobs and preserves the main body', () => {
    const w = 5, h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    const paint = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) paint(x, y, 200, 100, 50, 255);
    paint(4, 4, 50, 50, 50, 128);
    const out = dropOrphanBlobs(makeImage(data, w, h));
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(out.data[(y * w + x) * 4 + 3]).toBe(255);
      }
    }
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(0);
  });

  it('returns a fresh ImageDataLike (does not mutate input)', () => {
    const w = 3, h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    const snapshot = Array.from(data);
    dropOrphanBlobs(makeImage(data, w, h));
    expect(Array.from(data)).toEqual(snapshot);
  });
});

describe('fillSubjectHoles (core)', () => {
  const makeBodyWithHole = (holeX: number, holeY: number) => {
    const w = 7, h = 7;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 0] = 200; data[i * 4 + 1] = 100;
      data[i * 4 + 2] = 50;  data[i * 4 + 3] = 255;
    }
    data[(holeY * w + holeX) * 4 + 3] = 0;
    return { w, h, data };
  };

  it('fills a small interior hole enclosed by the subject body', () => {
    const { w, h, data } = makeBodyWithHole(3, 3);
    const out = fillSubjectHoles(makeImage(data, w, h));
    expect(out.data[(3 * w + 3) * 4 + 3]).toBe(255);
  });

  it('never fills α=0 regions that connect to the image border', () => {
    const w = 5, h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const snapshot = Array.from(data);
    const out = fillSubjectHoles(makeImage(data, w, h));
    expect(Array.from(out.data)).toEqual(snapshot);
  });
});

describe('promoteSpeckleAlpha (core)', () => {
  const makeBodyWithSpeck = (cx: number, cy: number, alphaVal: number) => {
    const w = 9, h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 0] = 200; data[i * 4 + 1] = 100;
      data[i * 4 + 2] = 50;  data[i * 4 + 3] = 255;
    }
    data[(cy * w + cx) * 4 + 3] = alphaVal;
    return { w, h, data };
  };

  it('promotes a semi-transparent speck surrounded by opaque neighbors to α=255', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 150);
    const out = promoteSpeckleAlpha(makeImage(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(255);
  });

  it('returns a fresh ImageDataLike (does not mutate input)', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 150);
    const snapshot = Array.from(data);
    promoteSpeckleAlpha(makeImage(data, w, h));
    expect(Array.from(data)).toEqual(snapshot);
  });
});

describe('keepLargestComponent (core)', () => {
  it('leaves a single component untouched', () => {
    const bin = new Uint8Array([0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const snapshot = Array.from(bin);
    keepLargestComponent(bin, 4, 3);
    expect(Array.from(bin)).toEqual(snapshot);
  });

  it('drops smaller components, keeps the largest', () => {
    const bin = new Uint8Array([1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    keepLargestComponent(bin, 5, 3);
    expect(Array.from(bin)).toEqual([1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
