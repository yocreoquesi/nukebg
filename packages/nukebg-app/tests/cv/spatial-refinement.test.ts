import { describe, it, expect } from 'vitest';
import { shadowCleanup } from '../../src/workers/cv/shadow-cleanup';
import { solidImage, paintRect } from '../helpers';

/**
 * Spatial refinement tests: removeSmallClusters / shadowCleanup.
 *
 * shadowCleanup identifies small foreground clusters with low saturation
 * (shadows, artifacts) and reclassifies them as background.
 */

describe('shadowCleanup (spatial refinement / removeSmallClusters)', () => {
  it('removes a small gray blob disconnected from the subject', () => {
    const w = 64,
      h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Large colorful subject (will not be removed)
    paintRect(pixels, w, 20, 20, 24, 24, 200, 50, 50);

    // Small gray blob (shadow/artifact) -- low saturation
    paintRect(pixels, w, 2, 2, 4, 4, 80, 80, 80);

    // Initial mask: all background except subject and blob
    const mask = new Uint8Array(w * h);
    mask.fill(1); // all background
    // Subject = foreground
    for (let y = 20; y < 44; y++) {
      for (let x = 20; x < 44; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob = foreground
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // The gray blob should have been removed (marked as background)
    expect(result[3 * w + 3]).toBe(1); // blob center

    // The colorful subject should remain as foreground
    expect(result[32 * w + 32]).toBe(0);
  });

  it('does not remove a large blob (exceeds maxBlobSize)', () => {
    const w = 128,
      h = 128;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Large gray blob (>maxBlobSize by default)
    paintRect(pixels, w, 0, 0, 128, 128, 100, 100, 100);

    // All foreground
    const mask = new Uint8Array(w * h); // all foreground (0)

    const result = shadowCleanup(pixels, w, h, mask, 100);

    // With maxBlobSize=100, the 128*128 blob doesn't fit, so it is NOT cleaned
    // (the blob exceeds maxBlobSize, marked as overflow and preserved)
    // Verify that at least the pixels remain as foreground
    let fgCount = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === 0) fgCount++;
    }
    // The large blob was not removed
    expect(fgCount).toBeGreaterThan(100);
  });

  it('does not touch pixels that are already background', () => {
    const w = 16,
      h = 16;
    const pixels = solidImage(w, h, 255, 255, 255);

    const mask = new Uint8Array(w * h);
    mask.fill(1); // all background

    const result = shadowCleanup(pixels, w, h, mask);

    // Everything remains as background
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(1);
    }
  });

  it('does not remove foreground with high saturation (real color, not shadow)', () => {
    const w = 32,
      h = 32;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Highly colorful blob (high saturation)
    paintRect(pixels, w, 5, 5, 6, 6, 255, 0, 0);

    // Mask: blob is foreground, rest is background
    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 5; y < 11; y++) {
      for (let x = 5; x < 11; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // The colorful blob (pure red, sat=1.0) should NOT be removed
    expect(result[7 * w + 7]).toBe(0);
  });

  it('removes multiple small independent shadow blobs', () => {
    const w = 64,
      h = 64;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Real subject
    paintRect(pixels, w, 25, 25, 14, 14, 200, 50, 50);

    // Shadow blob 1
    paintRect(pixels, w, 2, 2, 3, 3, 70, 70, 70);
    // Shadow blob 2
    paintRect(pixels, w, 55, 55, 3, 3, 90, 90, 90);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    // Subject
    for (let y = 25; y < 39; y++) {
      for (let x = 25; x < 39; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob 1
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        mask[y * w + x] = 0;
      }
    }
    // Blob 2
    for (let y = 55; y < 58; y++) {
      for (let x = 55; x < 58; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // Both shadow blobs removed
    expect(result[3 * w + 3]).toBe(1);
    expect(result[56 * w + 56]).toBe(1);

    // Subject intact
    expect(result[32 * w + 32]).toBe(0);
  });

  it('handles image with no foreground (all background)', () => {
    const w = 16,
      h = 16;
    const pixels = solidImage(w, h, 128, 128, 128);
    const mask = new Uint8Array(w * h).fill(1);

    // Should not crash
    const result = shadowCleanup(pixels, w, h, mask);
    expect(result.length).toBe(w * h);
  });

  it('handles image with all foreground (no background)', () => {
    const w = 16,
      h = 16;
    const pixels = solidImage(w, h, 200, 50, 50);
    const mask = new Uint8Array(w * h); // all foreground

    const result = shadowCleanup(pixels, w, h, mask);
    expect(result.length).toBe(w * h);
  });

  it('respects custom maxBlobSize parameter', () => {
    const w = 32,
      h = 32;
    const pixels = solidImage(w, h, 255, 255, 255);

    // Gray blob of 5x5 = 25 pixels
    paintRect(pixels, w, 2, 2, 5, 5, 80, 80, 80);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 2; y < 7; y++) {
      for (let x = 2; x < 7; x++) {
        mask[y * w + x] = 0;
      }
    }

    // With maxBlobSize=10, the 25px blob is NOT removed (exceeds)
    const resultSmall = shadowCleanup(pixels, w, h, new Uint8Array(mask), 10);
    expect(resultSmall[4 * w + 4]).toBe(0);

    // With maxBlobSize=30, the 25px blob IS removed
    const resultBig = shadowCleanup(pixels, w, h, new Uint8Array(mask), 30);
    expect(resultBig[4 * w + 4]).toBe(1);
  });

  it('does not remove bright pixels (brightness > MAX) or dark pixels (brightness < MIN)', () => {
    const w = 32,
      h = 32;
    const pixels = solidImage(w, h, 200, 200, 200);

    // Near-white blob (brightness > BRIGHTNESS_MAX=220)
    paintRect(pixels, w, 2, 2, 3, 3, 240, 240, 240);

    // Near-black blob (brightness < BRIGHTNESS_MIN=5)
    paintRect(pixels, w, 10, 10, 3, 3, 2, 2, 2);

    const mask = new Uint8Array(w * h);
    mask.fill(1);
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        mask[y * w + x] = 0;
      }
    }
    for (let y = 10; y < 13; y++) {
      for (let x = 10; x < 13; x++) {
        mask[y * w + x] = 0;
      }
    }

    const result = shadowCleanup(pixels, w, h, mask);

    // Both blobs are not shadow candidates (outside brightness range)
    // Therefore they remain as foreground
    expect(result[3 * w + 3]).toBe(0);
    expect(result[11 * w + 11]).toBe(0);
  });
});
