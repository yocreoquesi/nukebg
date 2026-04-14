import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { sparkleDetect } from '../../src/workers/cv/sparkle-detect';
import { solidImage } from '../helpers';

async function loadFixture(name: string): Promise<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const path = resolve(__dirname, '../fixtures', name);
  const { data, info } = await sharp(readFileSync(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/** Paints a 4-pointed Gemini-style sparkle (✦) into RGBA pixels. */
function paintSparkle(
  pixels: Uint8ClampedArray,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number] = [255, 255, 255],
): void {
  // 4-pointed star: |x|^p + |y|^p = r^p with p<1 gives a concave star
  const p = 0.6;
  const rp = Math.pow(radius, p);
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const inStar = Math.pow(ax, p) + Math.pow(ay, p) <= rp;
      const inDisc = dx * dx + dy * dy <= 9; // small bright core
      if (inStar || inDisc) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width) continue;
        const i = (y * width + x) * 4;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = 255;
      }
      // Ignore unused vars
      void r2;
    }
  }
}

describe('sparkleDetect', () => {
  it('detects the Gemini sparkle in a real selfie corner', async () => {
    const { pixels, width, height } = await loadFixture('selfie-sparkle-corner.png');

    const result = sparkleDetect(pixels, width, height);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    // Sparkle is at ~(287, 287) in the 400x400 fixture (measured)
    expect(result.centerX).toBeGreaterThan(240);
    expect(result.centerX).toBeLessThan(335);
    expect(result.centerY).toBeGreaterThan(240);
    expect(result.centerY).toBeLessThan(335);
    expect(result.radius).toBeGreaterThan(10);
    expect(result.radius).toBeLessThan(80);
  });

  it('does not detect a sparkle in a clean photo region (no watermark)', async () => {
    const { pixels, width, height } = await loadFixture('selfie-clean-corner.png');

    const result = sparkleDetect(pixels, width, height);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  it('does not detect on a solid color image', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 180, 140, 100);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(false);
  });

  it('detects a synthetic 4-pointed sparkle painted on a uniform bg', () => {
    const w = 400, h = 400;
    const pixels = solidImage(w, h, 90, 70, 60);
    // Paint a sparkle in the bottom-right area
    paintSparkle(pixels, w, 320, 320, 28, [230, 220, 215]);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.centerX).toBeGreaterThan(290);
    expect(result.centerX).toBeLessThan(350);
    expect(result.centerY).toBeGreaterThan(290);
    expect(result.centerY).toBeLessThan(350);
  });

  it('returns a non-empty circular mask when detected', () => {
    const w = 400, h = 400;
    const pixels = solidImage(w, h, 80, 80, 80);
    paintSparkle(pixels, w, 330, 330, 22, [240, 240, 240]);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    let count = 0;
    for (let i = 0; i < result.mask!.length; i++) if (result.mask![i]) count++;
    expect(count).toBeGreaterThan(0);
    // Mask should not cover more than 5% of the image
    expect(count).toBeLessThan(w * h * 0.05);
  });

  it('handles small images without crashing', () => {
    const w = 80, h = 80;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = sparkleDetect(pixels, w, h);

    expect(result).toBeDefined();
    expect(result.detected).toBe(false);
  });
});
