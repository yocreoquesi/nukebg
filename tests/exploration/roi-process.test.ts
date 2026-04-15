/**
 * Tests for exploration/roi-process.ts — the pure logic side of ROI processing.
 * Uses an injected segmenter stub so no model is needed.
 */

import { describe, it, expect } from 'vitest';
import { processRoi, rasterizePolygon, type PolygonPoint } from '../../exploration/roi-process';

if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class ImageDataStub {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: 'srgb' = 'srgb';
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as { ImageData?: unknown }).ImageData = ImageDataStub;
}

function makeImage(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return new ImageData(data, width, height);
}

describe('rasterizePolygon', () => {
  it('returns empty mask for degenerate polygons', () => {
    const mask = rasterizePolygon([], 10, 10);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('fills a triangle correctly (happy-dom canvas supports fill)', () => {
    const tri: PolygonPoint[] = [
      { x: 5, y: 1 },
      { x: 1, y: 9 },
      { x: 9, y: 9 },
    ];
    const mask = rasterizePolygon(tri, 10, 10);
    // Apex row should be empty or nearly so; bottom should have filled pixels.
    const topRow = Array.from(mask.slice(0, 10));
    const botRow = Array.from(mask.slice(8 * 10, 9 * 10));
    expect(topRow.reduce((a, b) => a + b, 0)).toBeLessThan(
      botRow.reduce((a, b) => a + b, 0),
    );
  });
});

describe('processRoi — mode crop', () => {
  it('zeros alpha outside polygon and applies segmentation inside', async () => {
    const W = 20;
    const H = 20;
    const original = makeImage(W, H, [100, 100, 100, 255]);
    const polygon: PolygonPoint[] = [
      { x: 4, y: 4 },
      { x: 16, y: 4 },
      { x: 16, y: 16 },
      { x: 4, y: 16 },
    ];

    const segment = async (
      _pixels: Uint8ClampedArray,
      width: number,
      height: number,
    ): Promise<Uint8Array> => {
      const out = new Uint8Array(width * height);
      out.fill(200);
      return out;
    };

    const { imageData, alpha } = await processRoi({
      original,
      polygon,
      previousAlpha: null,
      mode: 'crop',
      segment,
    });

    // Outside polygon corner: alpha must be 0.
    const outsideIdx = 0;
    expect(alpha[outsideIdx]).toBe(0);
    expect(imageData.data[outsideIdx * 4 + 3]).toBe(0);

    // Deep inside polygon (pixel 10,10): alpha from segment stub (200).
    const insideIdx = 10 * W + 10;
    expect(alpha[insideIdx]).toBe(200);
    expect(imageData.data[insideIdx * 4 + 3]).toBe(200);

    // Original RGB should be preserved.
    expect(imageData.data[insideIdx * 4]).toBe(100);
  });
});

describe('processRoi — mode refine', () => {
  it('preserves previous alpha outside polygon, applies new alpha inside', async () => {
    const W = 20;
    const H = 20;
    const original = makeImage(W, H, [50, 50, 50, 255]);
    const previousAlpha = new Uint8Array(W * H);
    previousAlpha.fill(77);

    const polygon: PolygonPoint[] = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];

    const segment = async (
      _pixels: Uint8ClampedArray,
      width: number,
      height: number,
    ): Promise<Uint8Array> => {
      const out = new Uint8Array(width * height);
      out.fill(222);
      return out;
    };

    const { alpha } = await processRoi({
      original,
      polygon,
      previousAlpha,
      mode: 'refine',
      segment,
    });

    // Outside polygon: previous alpha (77) preserved.
    expect(alpha[0]).toBe(77);
    // Inside polygon: new alpha from segment stub (222).
    expect(alpha[10 * W + 10]).toBe(222);
  });

  it('throws if previousAlpha is missing in refine mode', async () => {
    const original = makeImage(10, 10, [0, 0, 0, 255]);
    const polygon: PolygonPoint[] = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
    ];
    await expect(
      processRoi({
        original,
        polygon,
        previousAlpha: null,
        mode: 'refine',
        segment: async () => new Uint8Array(0),
      }),
    ).rejects.toThrow(/previousAlpha/);
  });
});

describe('processRoi — input validation', () => {
  it('rejects polygons with fewer than 3 points', async () => {
    const original = makeImage(10, 10, [0, 0, 0, 255]);
    await expect(
      processRoi({
        original,
        polygon: [{ x: 1, y: 1 }],
        previousAlpha: null,
        mode: 'crop',
        segment: async () => new Uint8Array(0),
      }),
    ).rejects.toThrow(/3 points/);
  });

  it('rejects selections smaller than 8px in either dimension', async () => {
    const original = makeImage(50, 50, [0, 0, 0, 255]);
    const polygon: PolygonPoint[] = [
      { x: 10, y: 10 },
      { x: 13, y: 10 },
      { x: 13, y: 13 },
    ];
    await expect(
      processRoi({
        original,
        polygon,
        previousAlpha: null,
        mode: 'crop',
        segment: async () => new Uint8Array(0),
      }),
    ).rejects.toThrow(/too small/);
  });
});
