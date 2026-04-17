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
    // Endpoints + midpoint + quarter points: normalized (a-80)/100
    const out = sharpenAlpha(new Uint8Array([80, 105, 130, 155, 180]));
    // 80 → 0, 180 → 255, 130 ≈ 128 (midpoint at n=0.5)
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
    expect(Math.abs(out[2] - 128)).toBeLessThanOrEqual(4);
    // smoothstep has zero slope at the endpoints: the quarter points
    // are pushed toward their nearer endpoint, not the linear 64/192.
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

  it('preserves weakly-detected body: mid-alpha inputs survive as soft α', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const out = sharpenAlpha(input);
    const soft = Array.from(out).filter((v) => v > 0 && v < 255).length;
    // Band is [80, 180] exclusive endpoints, minus rounding near the tails.
    // Mid band keeps enough weak-body range to hold the occluded elbow /
    // arm-torso gap while shaving the α=60..79 halo tail that survives
    // on flat backgrounds.
    expect(soft).toBeGreaterThan(75);
    expect(soft).toBeLessThan(105);
  });
});

describe('refineEdges', () => {
  it('without pipeline: RGB is untouched, α is sharpened', async () => {
    const w = 4, h = 1;
    const data = new Uint8ClampedArray(w * h * 4);
    // Connected blob on the left (opaque + AA edge), halo tail + transparent on the right.
    // Layout keeps both bin=1 pixels adjacent so the CC keep-largest pass preserves them.
    data.set([255, 0, 0, 255,   100, 100, 100, 200,   50, 50, 50, 30,   0, 0, 0, 0]);
    const img = new ImageData(data, w, h);

    const out = await refineEdges(null, img);

    // RGB preserved for all pixels
    for (let i = 0; i < w * h; i++) {
      expect(out.data[i * 4]).toBe(data[i * 4]);
      expect(out.data[i * 4 + 1]).toBe(data[i * 4 + 1]);
      expect(out.data[i * 4 + 2]).toBe(data[i * 4 + 2]);
    }

    // α=200 ≥ HIGH → 255, α=30 ≤ LOW → 0
    expect(out.data[3]).toBe(255);                // opaque endpoint
    expect(out.data[7]).toBeGreaterThan(215);     // was 200, sharpened to 255
    expect(out.data[11]).toBeLessThan(5);         // was 30, killed to 0
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
    expect(calls[0].w).toBe(2);
    expect(calls[0].h).toBe(1);
    // Alpha passed to the solver is post-sharpen (smoothstep [80, 180]),
    // not the raw RMBG value. Input α=128 is inside the band and maps
    // to roughly n=0.48 → ~118 (just below the midpoint).
    expect(calls[0].alphaSample).toBeGreaterThan(100);
    expect(calls[0].alphaSample).toBeLessThan(180);
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

  it('removes isolated opaque blobs disconnected from the main subject', async () => {
    // 5x5: a 3x3 opaque block in the middle (main subject) plus one
    // opaque pixel in the bottom-right corner (stray RMBG artifact).
    const w = 5, h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    const setPixel = (x: number, y: number, a: number) => {
      const i = (y * w + x) * 4;
      data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = a;
    };
    // Main 2x2 blob at (0,0)-(1,1), fully opaque
    for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) setPixel(x, y, 255);
    // Stray opaque pixel at (4,4), far from the blob (dilate1 radius is only 1 px)
    setPixel(4, 4, 255);

    const out = await refineEdges(null, new ImageData(data, w, h));

    // Main blob: still opaque
    for (let y = 0; y <= 1; y++) {
      for (let x = 0; x <= 1; x++) {
        expect(out.data[(y * w + x) * 4 + 3]).toBe(255);
      }
    }
    // Stray pixel: gone
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(0);
  });
});

describe('tailLuminanceVariance / hasHaloRisk', () => {
  // Build a synthetic frame: `tailCount` pixels with α in the tail range
  // and the given RGB, padded with opaque and transparent filler so the
  // tail-detector is the only thing that fires.
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
    // All tail pixels identical RGB → variance ≈ 0
    const { rgba, alpha } = makeFrame(300, () => [120, 120, 120]);
    const v = tailLuminanceVariance(rgba, alpha);
    expect(v).toBeLessThan(1);
    expect(hasHaloRisk(rgba, alpha)).toBe(true);
  });

  it('passes a textured background (high variance) as safe to refine', () => {
    // Wide spread of luminance values in the tail → high variance
    const { rgba, alpha } = makeFrame(300, (i) => {
      const v = (i * 37) % 256;
      return [v, v, v];
    });
    const v = tailLuminanceVariance(rgba, alpha);
    expect(v).toBeGreaterThan(1000);
    expect(hasHaloRisk(rgba, alpha)).toBe(false);
  });

  it('ignores pixels outside the tail α range [30, 100]', () => {
    // 200 opaque pixels + 200 transparent pixels — no tail samples at all
    const n = 400;
    const rgba = new Uint8ClampedArray(n * 4);
    const alpha = new Uint8Array(n);
    for (let i = 0; i < 200; i++) {
      alpha[i] = 255;
      rgba[i * 4 + 3] = 255;
    }
    expect(tailLuminanceVariance(rgba, alpha)).toBe(Infinity);
  });

  it('respects the caller-provided threshold override', () => {
    // Variance ≈ 0 here; hasHaloRisk(threshold=0) should return false
    const { rgba, alpha } = makeFrame(300, () => [50, 50, 50]);
    expect(hasHaloRisk(rgba, alpha, 100)).toBe(true);
    expect(hasHaloRisk(rgba, alpha, 0)).toBe(false);
  });
});

describe('dropOrphanBlobs', () => {
  it('zeros α on disconnected blobs and preserves the main body verbatim', () => {
    // 5x5 canvas. Main 3x3 opaque block top-left, stray opaque pixel at (4,4).
    const w = 5, h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    const paint = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) paint(x, y, 200, 100, 50, 255);
    paint(4, 4, 50, 50, 50, 128);

    const out = dropOrphanBlobs(new ImageData(data, w, h));

    // Main body: α preserved exactly
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(out.data[(y * w + x) * 4 + 3]).toBe(255);
      }
    }
    // Stray pixel: α zeroed
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(0);
  });

  it('does not mutate RGB on any pixel', () => {
    const w = 4, h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = (i * 7) % 256;
      data[i * 4 + 1] = (i * 13) % 256;
      data[i * 4 + 2] = (i * 19) % 256;
      data[i * 4 + 3] = i < 6 ? 200 : 0;
    }
    const snapshot = Array.from(data);

    const out = dropOrphanBlobs(new ImageData(data, w, h));

    for (let i = 0; i < w * h; i++) {
      expect(out.data[i * 4]).toBe(snapshot[i * 4]);
      expect(out.data[i * 4 + 1]).toBe(snapshot[i * 4 + 1]);
      expect(out.data[i * 4 + 2]).toBe(snapshot[i * 4 + 2]);
    }
  });

  it('preserves soft α on the AA ring of the kept component', () => {
    // 7x7 canvas: 3x3 block at (1..3,1..3) with opaque center + AA ring,
    // and a stray α=200 at (6,6) — Chebyshev distance 3 from the block,
    // far enough to survive 8-connectivity's diagonal reach.
    const w = 7, h = 7;
    const data = new Uint8ClampedArray(w * h * 4);
    const paint = (x: number, y: number, a: number) => {
      const i = (y * w + x) * 4;
      data[i] = 120; data[i + 1] = 120; data[i + 2] = 120; data[i + 3] = a;
    };
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        paint(x, y, (x === 2 && y === 2) ? 255 : 64);
      }
    }
    paint(6, 6, 200); // disconnected

    const out = dropOrphanBlobs(new ImageData(data, w, h));

    // AA ring around the main body kept (α=64 survives)
    expect(out.data[(1 * w + 1) * 4 + 3]).toBe(64);
    expect(out.data[(2 * w + 2) * 4 + 3]).toBe(255);
    // Stray dropped
    expect(out.data[(6 * w + 6) * 4 + 3]).toBe(0);
  });

  it('returns a fresh ImageData (does not mutate input)', () => {
    const w = 3, h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    const snapshot = Array.from(data);
    dropOrphanBlobs(new ImageData(data, w, h));
    expect(Array.from(data)).toEqual(snapshot);
  });
});

describe('fillSubjectHoles', () => {
  // Helper: 7x7 solid subject with a single α=0 speck at an interior pixel.
  // Border pixels remain α=255, so the speck is topologically enclosed.
  const makeBodyWithHole = (holeX: number, holeY: number) => {
    const w = 7, h = 7;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 0] = 200;
      data[i * 4 + 1] = 100;
      data[i * 4 + 2] = 50;
      data[i * 4 + 3] = 255;
    }
    data[(holeY * w + holeX) * 4 + 3] = 0;
    return { w, h, data };
  };

  it('fills a small interior hole enclosed by the subject body', () => {
    const { w, h, data } = makeBodyWithHole(3, 3);
    const out = fillSubjectHoles(new ImageData(data, w, h));
    expect(out.data[(3 * w + 3) * 4 + 3]).toBe(255);
  });

  it('preserves the surrounding RGB on a filled hole', () => {
    const { w, h, data } = makeBodyWithHole(3, 3);
    const out = fillSubjectHoles(new ImageData(data, w, h));
    const idx = (3 * w + 3) * 4;
    expect(out.data[idx + 0]).toBe(200);
    expect(out.data[idx + 1]).toBe(100);
    expect(out.data[idx + 2]).toBe(50);
  });

  it('leaves a large hole alone when it exceeds maxHoleSize', () => {
    const w = 10, h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    // Carve a 4x4 interior hole (16 px) at (3,3)-(6,6), border stays opaque.
    for (let y = 3; y <= 6; y++) {
      for (let x = 3; x <= 6; x++) data[(y * w + x) * 4 + 3] = 0;
    }
    const out = fillSubjectHoles(new ImageData(data, w, h), 4);
    for (let y = 3; y <= 6; y++) {
      for (let x = 3; x <= 6; x++) expect(out.data[(y * w + x) * 4 + 3]).toBe(0);
    }
  });

  it('never fills α=0 regions that connect to the image border', () => {
    const w = 5, h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    // Opaque 3x3 block at (1,1)-(3,3); everything else α=0 (connected to border).
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const snapshot = Array.from(data);
    const out = fillSubjectHoles(new ImageData(data, w, h));
    expect(Array.from(out.data)).toEqual(snapshot);
  });

  it('does not mutate RGB on any pixel', () => {
    const { w, h, data } = makeBodyWithHole(3, 3);
    data[(3 * w + 3) * 4 + 0] = 77;
    data[(3 * w + 3) * 4 + 1] = 88;
    data[(3 * w + 3) * 4 + 2] = 99;
    const out = fillSubjectHoles(new ImageData(data, w, h));
    const idx = (3 * w + 3) * 4;
    expect(out.data[idx + 0]).toBe(77);
    expect(out.data[idx + 1]).toBe(88);
    expect(out.data[idx + 2]).toBe(99);
  });

  it('returns a fresh ImageData (does not mutate input)', () => {
    const { w, h, data } = makeBodyWithHole(3, 3);
    const snapshot = Array.from(data);
    fillSubjectHoles(new ImageData(data, w, h));
    expect(Array.from(data)).toEqual(snapshot);
  });
});

describe('promoteSpeckleAlpha', () => {
  // Helper: 9x9 fully-opaque body with a single interior pixel at (cx, cy)
  // holding α=alphaVal and full RGB. A 5x5 window around (cx, cy) is all α=255,
  // so opaque_neighbors = 24/24 which clears the 75% ratio.
  const makeBodyWithSpeck = (cx: number, cy: number, alphaVal: number) => {
    const w = 9, h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4 + 0] = 200;
      data[i * 4 + 1] = 100;
      data[i * 4 + 2] = 50;
      data[i * 4 + 3] = 255;
    }
    data[(cy * w + cx) * 4 + 3] = alphaVal;
    return { w, h, data };
  };

  it('promotes a semi-transparent speck surrounded by opaque neighbors to α=255', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 150);
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(255);
  });

  it('leaves α=0 pixels alone (fillSubjectHoles handles those)', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 0);
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(0);
  });

  it('leaves α=255 pixels alone (already opaque)', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 255);
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(255);
  });

  it('does not promote AA edge pixels (neighborhood not opaque enough)', () => {
    const w = 9, h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    // Half-plane opaque: left 5 columns α=255, right 4 columns α=0.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data[(y * w + x) * 4 + 3] = x < 5 ? 255 : 0;
      }
    }
    // Put a soft AA pixel on the boundary at (4, 4) — it has ~half opaque
    // neighbors (below 75%), so it must stay soft.
    data[(4 * w + 4) * 4 + 3] = 180;
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(180);
  });

  it('does not mutate RGB on promoted pixels', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 150);
    data[(4 * w + 4) * 4 + 0] = 77;
    data[(4 * w + 4) * 4 + 1] = 88;
    data[(4 * w + 4) * 4 + 2] = 99;
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    const idx = (4 * w + 4) * 4;
    expect(out.data[idx + 0]).toBe(77);
    expect(out.data[idx + 1]).toBe(88);
    expect(out.data[idx + 2]).toBe(99);
  });

  it('returns a fresh ImageData (does not mutate input)', () => {
    const { w, h, data } = makeBodyWithSpeck(4, 4, 150);
    const snapshot = Array.from(data);
    promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(Array.from(data)).toEqual(snapshot);
  });

  it('snapshots α before writing so promotions do not cascade through adjacent specks', () => {
    // Two adjacent specks at (4,4) and (5,4). Without snapshotting, the first
    // promotion would feed into the second's neighborhood count — we want the
    // decision based on the ORIGINAL α only.
    const w = 9, h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    data[(4 * w + 4) * 4 + 3] = 100;
    data[(4 * w + 5) * 4 + 3] = 100;
    // Both have exactly 23/24 opaque neighbors under the snapshot (each sees
    // the other as α=100, not ≥240), which is 95.8% — still ≥ 75%. Both promote.
    const out = promoteSpeckleAlpha(new ImageData(data, w, h));
    expect(out.data[(4 * w + 4) * 4 + 3]).toBe(255);
    expect(out.data[(4 * w + 5) * 4 + 3]).toBe(255);
  });
});

describe('keepLargestComponent', () => {
  it('leaves a single component untouched', () => {
    const bin = new Uint8Array([
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ]);
    const snapshot = Array.from(bin);
    keepLargestComponent(bin, 4, 3);
    expect(Array.from(bin)).toEqual(snapshot);
  });

  it('drops smaller components, keeps the largest', () => {
    // Left 2x2 block (4 pixels) and right isolated pixel (1 pixel)
    const bin = new Uint8Array([
      1, 1, 0, 0, 1,
      1, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    keepLargestComponent(bin, 5, 3);
    expect(Array.from(bin)).toEqual([
      1, 1, 0, 0, 0,
      1, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
  });

  it('uses 8-connectivity (diagonal neighbors count as connected)', () => {
    // Two pixels touching only diagonally — one component under 8-connectivity
    const bin = new Uint8Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const snapshot = Array.from(bin);
    keepLargestComponent(bin, 3, 3);
    expect(Array.from(bin)).toEqual(snapshot);
  });

  it('handles an empty mask without errors', () => {
    const bin = new Uint8Array(9);
    keepLargestComponent(bin, 3, 3);
    expect(Array.from(bin)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
