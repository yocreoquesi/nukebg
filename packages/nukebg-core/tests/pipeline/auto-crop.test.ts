import { describe, it, expect } from 'vitest';
import { autoCropToSubject } from '../../src/pipeline/auto-crop';
import { createImageDataLike } from '../../src/types/image-data-like';
import type { ImageDataLike } from '../../src/types/image-data-like';

// Core runs in Node — NO ImageData global, NO polyfill.
// All inputs are plain ImageDataLike objects.

function blank(w: number, h: number): ImageDataLike {
  return createImageDataLike(new Uint8ClampedArray(w * h * 4), w, h);
}

function paintOpaque(img: ImageDataLike, x: number, y: number, w = 1, h = 1): void {
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

// ── REQ-CORE-PIPELINE-2 compliance ──

describe('autoCropToSubject — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract when crop occurs', () => {
    const img = blank(20, 20);
    paintOpaque(img, 5, 7, 3, 4);
    const out = autoCropToSubject(img);
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width', 3);
    expect(out).toHaveProperty('height', 4);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('return value is NOT an ImageData instance (plain object) when crop occurs', () => {
    const img = blank(20, 20);
    paintOpaque(img, 5, 7, 3, 4);
    const out = autoCropToSubject(img);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

// ── Behavioural tests ──

describe('autoCropToSubject (core)', () => {
  it('crops to the tight bbox of opaque pixels', () => {
    const img = blank(20, 20);
    paintOpaque(img, 5, 7, 3, 4);
    const out = autoCropToSubject(img);
    expect(out.width).toBe(3);
    expect(out.height).toBe(4);
    expect(out.data[0]).toBe(255);
    expect(out.data[3]).toBe(255);
  });

  it('returns the input unchanged when the canvas is fully opaque', () => {
    const img = blank(4, 4);
    paintOpaque(img, 0, 0, 4, 4);
    const out = autoCropToSubject(img);
    expect(out).toBe(img);
  });

  it('returns the input unchanged when there are zero opaque pixels', () => {
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
    paintOpaque(img, 0, 0);
    const out = autoCropToSubject(img, { padding: 5 });
    expect(out.width).toBe(6);
    expect(out.height).toBe(6);
  });

  it('respects a custom alphaThreshold', () => {
    const img = blank(10, 10);
    paintOpaque(img, 4, 4);
    // faint pixel
    img.data[3] = 2;
    img.data[0] = 100;
    const out = autoCropToSubject(img, { alphaThreshold: 10 });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});
