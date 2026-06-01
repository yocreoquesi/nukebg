import { describe, it, expect } from 'vitest';
import { autoCropToSubject } from '../../src/utils/auto-crop';

// happy-dom doesn't ship ImageData — same polyfill the other pipeline tests use.
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      maybeHeight?: number,
    ) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? dataOrWidth.length / (widthOrHeight * 4);
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

function blank(w: number, h: number): ImageData {
  // Allocates with α=0 everywhere — the baseline "transparent canvas".
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

function paintOpaque(img: ImageData, x: number, y: number, w = 1, h = 1): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = ((y + dy) * img.width + (x + dx)) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
}

describe('autoCropToSubject', () => {
  it('crops to the tight bbox of opaque pixels', () => {
    const img = blank(20, 20);
    paintOpaque(img, 5, 7, 3, 4); // bbox = (5,7) to (7,10), 3x4
    const out = autoCropToSubject(img);
    expect(out.width).toBe(3);
    expect(out.height).toBe(4);
    // Top-left of the crop should match the source's (5,7).
    expect(out.data[0]).toBe(255); // R
    expect(out.data[3]).toBe(255); // A
  });

  it('returns the input unchanged when the canvas is fully opaque', () => {
    const img = blank(4, 4);
    paintOpaque(img, 0, 0, 4, 4);
    const out = autoCropToSubject(img);
    expect(out).toBe(img); // same reference — no allocation
  });

  it('returns the input unchanged when there are zero opaque pixels', () => {
    // Degenerate: nothing to crop to. A 0×0 PNG is useless, so keep
    // the original and let the caller decide what to do.
    const img = blank(8, 8);
    const out = autoCropToSubject(img);
    expect(out).toBe(img);
  });

  it('preserves a single-pixel subject', () => {
    const img = blank(50, 50);
    paintOpaque(img, 30, 20);
    const out = autoCropToSubject(img);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.data[3]).toBe(255);
  });

  it('handles padding without going out of bounds', () => {
    const img = blank(10, 10);
    paintOpaque(img, 0, 0); // corner pixel
    const out = autoCropToSubject(img, { padding: 5 });
    // padding clipped at the canvas edge.
    expect(out.width).toBe(6);
    expect(out.height).toBe(6);
  });

  it('respects a custom alphaThreshold (rejects faint AA tail)', () => {
    const img = blank(10, 10);
    // strong subject in the centre
    paintOpaque(img, 4, 4);
    // faint pixel at (0,0): α=2 — would be picked up by default threshold
    // but rejected when threshold=10.
    img.data[3] = 2;
    img.data[0] = 100;
    const out = autoCropToSubject(img, { alphaThreshold: 10 });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});
