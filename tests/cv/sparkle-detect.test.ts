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

/** Paints a realistic 4-pointed Gemini-style sparkle (✦) — thin tapering
 *  arms along cardinals + bright circular core. Shape matches the assumptions
 *  of sparkleDetect (narrow cross-section arms, bright center peak). */
function paintSparkle(
  pixels: Uint8ClampedArray,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number] = [255, 255, 255],
): void {
  const setPx = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width) return;
    const i = (y * width + x) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = 255;
  };
  const coreR = Math.max(2, Math.round(radius * 0.18));
  const coreR2 = coreR * coreR;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const dist = Math.max(ax, ay);
      if (dist > radius) continue;
      // Arms taper from core thickness to 1px at the tip.
      const armThickness = Math.max(1, Math.round(coreR * (1 - dist / radius)));
      const inHArm = ay <= armThickness && ax <= radius;
      const inVArm = ax <= armThickness && ay <= radius;
      const inCore = dx * dx + dy * dy <= coreR2;
      if (inHArm || inVArm || inCore) setPx(cx + dx, cy + dy);
    }
  }
}

describe('sparkleDetect', () => {
  it('detects the Gemini sparkle in a real selfie (full image)', async () => {
    const { pixels, width, height } = await loadFixture('selfie-sparkle-full.png');

    const result = sparkleDetect(pixels, width, height);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    // Sparkle sits in the bottom-right quadrant of the downscaled selfie
    expect(result.centerX).toBeGreaterThan(width * 0.75);
    expect(result.centerY).toBeGreaterThan(height * 0.70);
    // Radius should be within the relative band (1.5%-5.5% of min dim)
    const minDim = Math.min(width, height);
    expect(result.radius).toBeGreaterThanOrEqual(Math.floor(minDim * 0.015));
    expect(result.radius).toBeLessThanOrEqual(Math.ceil(minDim * 0.055));
  });

  it('does not detect a sparkle in a clean photo region (no watermark)', async () => {
    const { pixels, width, height } = await loadFixture('selfie-clean-corner.png');

    const result = sparkleDetect(pixels, width, height);

    expect(result.detected).toBe(false);
    expect(result.mask).toBeNull();
  });

  // Real-world negatives — production false positives we must reject.
  const cleanFixtures = [
    'motorcycles-clean.png',
    'fiat-clean.png',
    'trump-clean.png',
  ] as const;
  for (const name of cleanFixtures) {
    it(`does not detect on clean real photo: ${name}`, async () => {
      const { pixels, width, height } = await loadFixture(name);
      const result = sparkleDetect(pixels, width, height);
      expect(result.detected).toBe(false);
    });
  }

  it('does not detect on a solid color image', () => {
    const w = 512, h = 512;
    const pixels = solidImage(w, h, 180, 140, 100);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(false);
  });

  it('detects a synthetic 4-pointed sparkle painted on a uniform bg', () => {
    const w = 500, h = 500;
    const pixels = solidImage(w, h, 90, 70, 60);
    // Paint a sparkle in the bottom-right area. Radius 20 sits inside the
    // detector's 1.5-5.5% band (500 * 0.055 = 27.5).
    paintSparkle(pixels, w, 420, 420, 20, [230, 220, 215]);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.centerX).toBeGreaterThan(395);
    expect(result.centerX).toBeLessThan(445);
    expect(result.centerY).toBeGreaterThan(395);
    expect(result.centerY).toBeLessThan(445);
  });

  it('returns a non-empty circular mask when detected', () => {
    const w = 500, h = 500;
    const pixels = solidImage(w, h, 80, 80, 80);
    paintSparkle(pixels, w, 430, 430, 18, [240, 240, 240]);

    const result = sparkleDetect(pixels, w, h);

    expect(result.detected).toBe(true);
    expect(result.mask).not.toBeNull();
    let count = 0;
    for (let i = 0; i < result.mask!.length; i++) if (result.mask![i]) count++;
    expect(count).toBeGreaterThan(0);
    // Mask should not cover more than 2% of the image
    expect(count).toBeLessThan(w * h * 0.02);
  });

  it('handles small images without crashing', () => {
    const w = 80, h = 80;
    const pixels = solidImage(w, h, 200, 200, 200);

    const result = sparkleDetect(pixels, w, h);

    expect(result).toBeDefined();
    expect(result.detected).toBe(false);
  });
});
