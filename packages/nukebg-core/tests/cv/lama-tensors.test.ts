import { describe, it, expect } from 'vitest';
import {
  packRgbaToChw,
  packMaskToChw,
  unpackChwToRgba,
} from '../../src/cv/lama-tensors';

describe('packRgbaToChw', () => {
  it('packs RGBA into NCHW RGB planes normalized /255, dropping alpha', () => {
    // 2x1 image: pixel0 = (0,128,255,10), pixel1 = (64,0,255,20).
    const rgba = new Uint8ClampedArray([0, 128, 255, 10, 64, 0, 255, 20]);
    const out = packRgbaToChw(rgba, 2, 1);
    const plane = 2 * 1;
    expect(out.length).toBe(3 * plane);
    // R plane
    expect(out[0]).toBeCloseTo(0 / 255, 6);
    expect(out[1]).toBeCloseTo(64 / 255, 6);
    // G plane
    expect(out[plane + 0]).toBeCloseTo(128 / 255, 6);
    expect(out[plane + 1]).toBeCloseTo(0 / 255, 6);
    // B plane
    expect(out[2 * plane + 0]).toBeCloseTo(255 / 255, 6);
    expect(out[2 * plane + 1]).toBeCloseTo(255 / 255, 6);
  });
});

describe('packMaskToChw', () => {
  it('packs a binary mask into a single float plane (0 or 1)', () => {
    const mask = new Uint8Array([0, 5, 0, 255]);
    const out = packMaskToChw(mask, 2, 2);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([0, 1, 0, 1]);
  });
});

describe('unpackChwToRgba', () => {
  it('unpacks NCHW RGB planes back to RGBA with alpha 255', () => {
    const plane = 2; // 2x1
    const chw = new Float32Array(3 * plane);
    // pixel0 = (10,20,30), pixel1 = (40,50,60)
    chw[0] = 10;
    chw[1] = 40; // R
    chw[plane + 0] = 20;
    chw[plane + 1] = 50; // G
    chw[2 * plane + 0] = 30;
    chw[2 * plane + 1] = 60; // B
    const rgba = unpackChwToRgba(chw, 2, 1);
    expect(rgba.length).toBe(2 * 4);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('round-trips a tiny image through pack -> (x255) -> unpack', () => {
    const width = 2;
    const height = 2;
    const rgba = new Uint8ClampedArray([
      0, 128, 255, 255, 64, 32, 16, 255, 200, 100, 50, 255, 255, 255, 255, 255,
    ]);
    const chw = packRgbaToChw(rgba, width, height);
    // Model output plane is in [0,1]; here we invert the /255 to recover pixels.
    const scaled = new Float32Array(chw.length);
    for (let i = 0; i < chw.length; i++) scaled[i] = (chw[i] ?? 0) * 255;
    const back = unpackChwToRgba(scaled, width, height);
    // RGB restored exactly; alpha forced to 255.
    for (let p = 0; p < width * height; p++) {
      expect(back[p * 4]).toBe(rgba[p * 4]);
      expect(back[p * 4 + 1]).toBe(rgba[p * 4 + 1]);
      expect(back[p * 4 + 2]).toBe(rgba[p * 4 + 2]);
      expect(back[p * 4 + 3]).toBe(255);
    }
  });
});
