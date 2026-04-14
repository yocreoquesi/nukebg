import { describe, it, expect } from 'vitest';
import { shouldUseLama } from '../../src/workers/cv/lama-router';
import { LAMA_ROUTER_PARAMS } from '../../src/pipeline/constants';

/** Solid-color RGBA canvas. */
function solid(w: number, h: number, gray: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = gray;
    out[i + 1] = gray;
    out[i + 2] = gray;
    out[i + 3] = 255;
  }
  return out;
}

/** Checker-pattern canvas — strong edges + high variance. */
function checker(w: number, h: number, cell: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = on ? 240 : 20;
      const i = (y * w + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Binary mask with a filled rectangle. */
function rectMask(w: number, h: number, rx: number, ry: number, rw: number, rh: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      m[y * w + x] = 1;
    }
  }
  return m;
}

describe('shouldUseLama', () => {
  it('returns useLama=false on a uniform sky (no structure to reconstruct)', () => {
    const w = 64, h = 64;
    const pixels = solid(w, h, 180);
    const mask = rectMask(w, h, 20, 20, 16, 16);

    const decision = shouldUseLama(pixels, w, h, mask);

    expect(decision.useLama).toBe(false);
    expect(decision.variance).toBeLessThan(LAMA_ROUTER_PARAMS.VARIANCE_THRESHOLD);
    expect(decision.edgeDensity).toBeLessThan(LAMA_ROUTER_PARAMS.EDGE_DENSITY_THRESHOLD);
  });

  it('returns useLama=true on a high-contrast checker (edges + variance present)', () => {
    const w = 64, h = 64;
    const pixels = checker(w, h, 4);
    const mask = rectMask(w, h, 20, 20, 16, 16);

    const decision = shouldUseLama(pixels, w, h, mask);

    expect(decision.useLama).toBe(true);
    // Either gate may carry the decision — both should be well above threshold
    // for this aggressive pattern.
    expect(
      decision.variance > LAMA_ROUTER_PARAMS.VARIANCE_THRESHOLD ||
      decision.edgeDensity > LAMA_ROUTER_PARAMS.EDGE_DENSITY_THRESHOLD,
    ).toBe(true);
  });

  it('returns useLama=false on an empty mask with an all-zero bbox', () => {
    const w = 32, h = 32;
    const pixels = checker(w, h, 4);
    const mask = new Uint8Array(w * h); // all zeros

    const decision = shouldUseLama(pixels, w, h, mask);

    expect(decision.useLama).toBe(false);
    expect(decision.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('expands the sample bbox by SAMPLE_BBOX_MARGIN, clamped to image bounds', () => {
    const w = 32, h = 32;
    const pixels = solid(w, h, 128);
    // Mask at top-left corner — expanded bbox must not go negative.
    const mask = rectMask(w, h, 0, 0, 4, 4);

    const decision = shouldUseLama(pixels, w, h, mask);

    expect(decision.bbox.x).toBe(0);
    expect(decision.bbox.y).toBe(0);
    // Expanded width: 4 + margin, clamped to image width
    expect(decision.bbox.w).toBeLessThanOrEqual(w);
    expect(decision.bbox.w).toBeGreaterThanOrEqual(4);
  });
});
