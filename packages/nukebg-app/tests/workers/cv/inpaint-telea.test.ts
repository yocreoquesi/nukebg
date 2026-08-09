import { describe, it, expect } from 'vitest';
import { inpaintTelea } from '../../../src/workers/cv/inpaint-telea';

/**
 * Behavioural tests for inpaintTelea (#195).
 *
 * Telea's Fast Marching Method is propagation-order dependent, so we
 * assert structural invariants (output bounds, mask-only mutation,
 * within-source value range) rather than trying to hand-compute the
 * exact reconstructed RGBA.
 */

function solidImage(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function rgbAt(
  px: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

describe('inpaintTelea', () => {
  describe('basic invariants', () => {
    it('returns a buffer of the same length as input', () => {
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [100, 50, 200]);
      const mask = new Uint8Array(w * h);
      mask[8 * w + 8] = 1;

      const out = inpaintTelea(px, w, h, mask);
      expect(out.length).toBe(px.length);
    });

    it('returns input unchanged when mask is all zeros', () => {
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [42, 99, 200]);
      const mask = new Uint8Array(w * h);
      const out = inpaintTelea(px, w, h, mask);
      // Pixel-for-pixel equality (no mask = no work)
      for (let i = 0; i < px.length; i++) {
        expect(out[i]).toBe(px[i]);
      }
    });

    it('does not mutate pixels outside the mask', () => {
      const w = 20;
      const h = 20;
      const px = solidImage(w, h, [200, 100, 50]);
      const mask = new Uint8Array(w * h);
      // 3x3 mask in the middle
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          mask[(10 + dy) * w + (10 + dx)] = 1;
        }
      }
      const out = inpaintTelea(px, w, h, mask);
      // Far corner unchanged
      expect(rgbAt(out, 0, 0, w)).toEqual([200, 100, 50, 255]);
      expect(rgbAt(out, w - 1, h - 1, w)).toEqual([200, 100, 50, 255]);
      // Pixel adjacent to but outside mask unchanged
      expect(rgbAt(out, 10, 7, w)).toEqual([200, 100, 50, 255]);
    });

    it('writes alpha=255 inside the mask region', () => {
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [128, 128, 128]);
      // Drop alpha to 100 outside (Telea promises opaque output INSIDE
      // the mask only — outside is preserved verbatim).
      for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 100;
      const mask = new Uint8Array(w * h);
      mask[8 * w + 8] = 1;

      const out = inpaintTelea(px, w, h, mask);
      // Inside mask: alpha forced to 255
      expect(out[(8 * w + 8) * 4 + 3]).toBe(255);
      // Outside mask: alpha preserved (100, not 255)
      expect(out[(0 * w + 0) * 4 + 3]).toBe(100);
    });
  });

  describe('reconstruction bounds', () => {
    it('reconstructs masked pixels within the [min, max] of source RGB', () => {
      // Solid 100/50/200 background with a 3x3 hole. Reconstruction
      // should produce values in [100, 100] / [50, 50] / [200, 200] —
      // i.e., reproduce the surrounding solid color (or stay within it).
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [100, 50, 200]);
      const mask = new Uint8Array(w * h);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          mask[(8 + dy) * w + (8 + dx)] = 1;
        }
      }
      const out = inpaintTelea(px, w, h, mask);
      // Every masked pixel should land at exactly (100, 50, 200) since
      // every neighbor is the same color. Tight invariant.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [r, g, b, a] = rgbAt(out, 8 + dx, 8 + dy, w);
          expect(r).toBe(100);
          expect(g).toBe(50);
          expect(b).toBe(200);
          expect(a).toBe(255);
        }
      }
    });

    it('keeps reconstructed RGB inside source RGB envelope on a 2-color split', () => {
      // Left half red, right half blue, with a vertical-line hole down
      // the middle. Reconstruction must yield colors in [red, blue]
      // envelope per channel — never extrapolate outside.
      const w = 20;
      const h = 16;
      const px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const isLeft = x < w / 2;
          px[i] = isLeft ? 200 : 0;
          px[i + 1] = 0;
          px[i + 2] = isLeft ? 0 : 200;
          px[i + 3] = 255;
        }
      }
      const mask = new Uint8Array(w * h);
      const xMid = Math.floor(w / 2);
      for (let y = 4; y < h - 4; y++) mask[y * w + xMid] = 1;

      const out = inpaintTelea(px, w, h, mask);
      for (let y = 4; y < h - 4; y++) {
        const [r, g, b] = rgbAt(out, xMid, y, w);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(200);
        expect(g).toBe(0); // both sides have G=0; reconstruction must not invent
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('robustness', () => {
    it('honors a custom radius without throwing', () => {
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [50, 50, 50]);
      const mask = new Uint8Array(w * h);
      mask[8 * w + 8] = 1;
      expect(() => inpaintTelea(px, w, h, mask, 3)).not.toThrow();
      expect(() => inpaintTelea(px, w, h, mask, 9)).not.toThrow();
    });

    it('survives a mask covering > 50% of the canvas (slow but should not infinite-loop)', () => {
      const w = 16;
      const h = 16;
      const px = solidImage(w, h, [128, 64, 192]);
      const mask = new Uint8Array(w * h);
      // Mask everything except the outer 2-pixel ring
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          mask[y * w + x] = 1;
        }
      }
      const before = Date.now();
      const out = inpaintTelea(px, w, h, mask);
      const elapsed = Date.now() - before;
      expect(elapsed).toBeLessThan(5000);
      // The masked center is in a ring of solid 128/64/192 — should
      // reconstruct very close to that color.
      const [r, g, b, a] = rgbAt(out, 8, 8, w);
      expect(r).toBeGreaterThanOrEqual(120);
      expect(r).toBeLessThanOrEqual(136);
      expect(g).toBeGreaterThanOrEqual(56);
      expect(g).toBeLessThanOrEqual(72);
      expect(b).toBeGreaterThanOrEqual(184);
      expect(b).toBeLessThanOrEqual(200);
      expect(a).toBe(255);
    });
  });
});
