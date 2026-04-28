import { describe, it, expect } from 'vitest';
import { BrushStroke } from '../../src/lib/brush-stroke';

/**
 * Behavioural tests for BrushStroke.apply() — the pixel arithmetic
 * pulled out of ar-editor.ts in #47/Phase-2.
 *
 * Strategy: build tiny ImageData buffers with a known initial pattern,
 * apply a stroke, and assert exact pixel mutations. No DOM, no canvas.
 */

function makeImage(w: number, h: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  // happy-dom doesn't ship a real ImageData ctor in every version — stub
  // the minimum surface our code reads.
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

function alphaAt(img: ImageData, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3];
}

function rgbaAt(img: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe('BrushStroke', () => {
  describe('erase tool', () => {
    it('zeros alpha inside a square footprint', () => {
      const img = makeImage(5, 5, [200, 100, 50, 255]);
      const orig = makeImage(5, 5, [10, 20, 30, 255]); // unused for erase
      const stroke = new BrushStroke({ cx: 2, cy: 2, tool: 'erase', size: 3, shape: 'square' });

      stroke.apply(img, orig, 5, 5);

      // Center 3x3 cleared (radius=1 → covers cx±1, cy±1)
      for (let y = 1; y <= 3; y++) {
        for (let x = 1; x <= 3; x++) {
          expect(alphaAt(img, x, y)).toBe(0);
        }
      }
      // Corners untouched
      expect(alphaAt(img, 0, 0)).toBe(255);
      expect(alphaAt(img, 4, 4)).toBe(255);
      // RGB preserved (erase only touches alpha)
      expect(rgbaAt(img, 2, 2)).toEqual([200, 100, 50, 0]);
    });

    it('clips to circular footprint when shape=circle', () => {
      // size=3 → r=1 → r²=1. Diagonals (dx²+dy²=2) get skipped.
      const img = makeImage(5, 5, [255, 255, 255, 255]);
      const orig = makeImage(5, 5, [0, 0, 0, 0]);
      const stroke = new BrushStroke({ cx: 2, cy: 2, tool: 'erase', size: 3, shape: 'circle' });

      stroke.apply(img, orig, 5, 5);

      // Cardinal neighbours cleared
      expect(alphaAt(img, 2, 2)).toBe(0); // center
      expect(alphaAt(img, 1, 2)).toBe(0);
      expect(alphaAt(img, 3, 2)).toBe(0);
      expect(alphaAt(img, 2, 1)).toBe(0);
      expect(alphaAt(img, 2, 3)).toBe(0);
      // Diagonal corners preserved
      expect(alphaAt(img, 1, 1)).toBe(255);
      expect(alphaAt(img, 3, 3)).toBe(255);
    });

    it('skips pixels outside image bounds without throwing', () => {
      const img = makeImage(3, 3, [100, 100, 100, 255]);
      const orig = makeImage(3, 3, [0, 0, 0, 0]);
      // Centered at (0,0) with size=5 — half the footprint is OOB.
      const stroke = new BrushStroke({ cx: 0, cy: 0, tool: 'erase', size: 5, shape: 'square' });

      expect(() => stroke.apply(img, orig, 3, 3)).not.toThrow();
      // In-bounds pixels in the top-left quadrant were touched.
      expect(alphaAt(img, 0, 0)).toBe(0);
      expect(alphaAt(img, 1, 1)).toBe(0);
      expect(alphaAt(img, 2, 2)).toBe(0);
    });
  });

  describe('restore tool', () => {
    it('copies RGBA from originalImage at every painted pixel', () => {
      const img = makeImage(5, 5, [0, 0, 0, 0]); // fully erased state
      const orig = makeImage(5, 5, [220, 110, 55, 200]);
      const stroke = new BrushStroke({ cx: 2, cy: 2, tool: 'restore', size: 3, shape: 'square' });

      stroke.apply(img, orig, 5, 5);

      expect(rgbaAt(img, 2, 2)).toEqual([220, 110, 55, 200]);
      expect(rgbaAt(img, 1, 1)).toEqual([220, 110, 55, 200]);
      expect(rgbaAt(img, 3, 3)).toEqual([220, 110, 55, 200]);
      // Outside footprint untouched (still erased)
      expect(rgbaAt(img, 0, 0)).toEqual([0, 0, 0, 0]);
    });

    it('respects circle shape clipping in restore mode too', () => {
      const img = makeImage(5, 5, [0, 0, 0, 0]);
      const orig = makeImage(5, 5, [255, 0, 0, 255]);
      const stroke = new BrushStroke({ cx: 2, cy: 2, tool: 'restore', size: 3, shape: 'circle' });

      stroke.apply(img, orig, 5, 5);

      expect(rgbaAt(img, 2, 2)).toEqual([255, 0, 0, 255]);
      expect(rgbaAt(img, 1, 1)).toEqual([0, 0, 0, 0]); // diagonal skipped
    });
  });

  describe('immutability', () => {
    it('exposes config as readonly fields', () => {
      const stroke = new BrushStroke({ cx: 5, cy: 7, tool: 'erase', size: 10, shape: 'circle' });
      expect(stroke.cx).toBe(5);
      expect(stroke.cy).toBe(7);
      expect(stroke.tool).toBe('erase');
      expect(stroke.size).toBe(10);
      expect(stroke.shape).toBe('circle');
    });
  });
});
