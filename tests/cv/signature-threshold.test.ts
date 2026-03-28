import { describe, it, expect } from 'vitest';
import { signatureThreshold, computeOtsu, morphologicalClose } from '../../src/workers/cv/signature-threshold';
import { solidImage } from '../helpers';

describe('signatureThreshold', () => {
  it('extracts dark strokes on white background', () => {
    const w = 100, h = 100;
    // White background
    const pixels = solidImage(w, h, 255, 255, 255);
    // Draw a black horizontal stripe at y=50
    for (let x = 10; x < 90; x++) {
      for (let y = 48; y < 53; y++) {
        const i = (y * w + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
      }
    }

    const alpha = signatureThreshold(pixels, w, h);

    expect(alpha.length).toBe(w * h);

    // Background (corner) should be transparent
    expect(alpha[0]).toBe(0);

    // Stroke center should be opaque
    const strokeIdx = 50 * w + 50;
    expect(alpha[strokeIdx]).toBe(255);
  });

  it('handles gray background with dark strokes via Sauvola', () => {
    const w = 300, h = 300;
    // Gray background (not white)
    const pixels = solidImage(w, h, 180, 180, 180);
    // Draw black strokes
    for (let x = 30; x < 270; x++) {
      for (let y = 148; y < 153; y++) {
        const i = (y * w + x) * 4;
        pixels[i] = 10;
        pixels[i + 1] = 10;
        pixels[i + 2] = 10;
      }
    }

    const alpha = signatureThreshold(pixels, w, h);

    // Stroke pixels should have high alpha (detected as foreground)
    const strokeIdx = 150 * w + 150;
    expect(alpha[strokeIdx]).toBeGreaterThan(128);

    // Background pixels should have low alpha
    expect(alpha[0]).toBeLessThan(128);
  });

  it('returns all transparent for all-white image', () => {
    const w = 100, h = 100;
    const pixels = solidImage(w, h, 255, 255, 255);

    const alpha = signatureThreshold(pixels, w, h);

    // Every pixel should be 0 (no foreground)
    let maxAlpha = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] > maxAlpha) maxAlpha = alpha[i];
    }
    expect(maxAlpha).toBe(0);
  });

  it('returns uniform alpha for all-black image (no contrast to detect)', () => {
    const w = 100, h = 100;
    const pixels = solidImage(w, h, 0, 0, 0);

    const alpha = signatureThreshold(pixels, w, h);

    // Uniform image has no foreground/background distinction.
    // All pixels get the same value (midpoint of the AA band).
    // Verify all pixels are equal (uniform).
    const first = alpha[0];
    let allEqual = true;
    for (let i = 1; i < alpha.length; i++) {
      if (alpha[i] !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
    // Value should be at the midpoint of the anti-aliasing band
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(255);
  });

  it('falls back to Otsu for small images', () => {
    const w = 50, h = 50;
    // Small image: should use Otsu, not Sauvola
    const pixels = solidImage(w, h, 255, 255, 255);
    // Add a dark spot
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
      }
    }

    const alpha = signatureThreshold(pixels, w, h);

    // Should still produce reasonable results
    expect(alpha.length).toBe(w * h);
    // Dark spot should be foreground
    const centerIdx = 25 * w + 25;
    expect(alpha[centerIdx]).toBe(255);
    // White area should be background
    expect(alpha[0]).toBe(0);
  });
});

describe('computeOtsu', () => {
  it('finds threshold between bimodal distribution', () => {
    // 50% pixels at brightness 50, 50% at brightness 200
    const gray = new Float32Array(1000);
    for (let i = 0; i < 500; i++) gray[i] = 50;
    for (let i = 500; i < 1000; i++) gray[i] = 200;

    const threshold = computeOtsu(gray);

    // Threshold should be between the two modes
    expect(threshold).toBeGreaterThan(49);
    expect(threshold).toBeLessThan(201);
  });

  it('handles uniform image', () => {
    const gray = new Float32Array(1000);
    gray.fill(128);

    const threshold = computeOtsu(gray);

    // Should return some value without crashing
    expect(threshold).toBeGreaterThanOrEqual(0);
    expect(threshold).toBeLessThanOrEqual(255);
  });
});

describe('morphologicalClose', () => {
  it('fills single-pixel gap in a horizontal line', () => {
    const w = 10, h = 5;
    const alpha = new Uint8Array(w * h);

    // Horizontal line at y=2 with a 1px gap at x=5
    for (let x = 0; x < w; x++) {
      if (x !== 5) alpha[2 * w + x] = 255;
    }

    morphologicalClose(alpha, w, h, 1);

    // Gap should be filled after close
    expect(alpha[2 * w + 5]).toBe(255);
  });

  it('does not expand isolated pixels beyond close radius', () => {
    const w = 20, h = 20;
    const alpha = new Uint8Array(w * h);

    // Single isolated pixel at center
    alpha[10 * w + 10] = 255;

    morphologicalClose(alpha, w, h, 1);

    // After dilate+erode with radius 1, isolated pixel should remain
    // (dilate expands, erode shrinks back — single pixel survives close)
    expect(alpha[10 * w + 10]).toBe(255);

    // Far away pixels should still be 0
    expect(alpha[0]).toBe(0);
    expect(alpha[19 * w + 19]).toBe(0);
  });
});
