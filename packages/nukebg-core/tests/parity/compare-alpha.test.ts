import { describe, it, expect } from 'vitest';
import { compareAlpha } from '../../src/parity/compare-alpha.js';
import { createImageDataLike } from '../../src/types/image-data-like.js';

// ---------------------------------------------------------------------------
// compareAlpha unit tests
// ---------------------------------------------------------------------------
//
// These cover REQ-PARITY-1's three thresholds directly with hand-computed
// pixel grids, independent of any model or fixture — this is the part of
// Phase 17 that must be green NOW (see parity.test.ts for the model-gated
// end-to-end comparison, which skips locally per REQ-PARITY-4).

/** Build a uniform WxH RGBA image where every pixel has the same [r,g,b,a]. */
function uniformImage(width: number, height: number, r: number, g: number, b: number, a: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
  return createImageDataLike(data, width, height);
}

/** Clone an image's pixel data so mutations don't alias the source. */
function cloneImage(image: ReturnType<typeof uniformImage>) {
  return createImageDataLike(new Uint8ClampedArray(image.data), image.width, image.height);
}

describe('compareAlpha (REQ-PARITY-1)', () => {
  it('reports a perfect match for identical images', () => {
    const a = uniformImage(2, 2, 200, 100, 50, 255);
    const b = cloneImage(a);

    const result = compareAlpha(a, b);

    expect(result.totalPixels).toBe(4);
    expect(result.maxAlphaDiff).toBe(0);
    expect(result.diffPixelCount).toBe(0);
    expect(result.diffPixelRatio).toBe(0);
    expect(result.alphaWithinEpsilon).toBe(true);
    expect(result.diffRatioWithinBudget).toBe(true);
    expect(result.subjectPixelCount).toBe(4);
    expect(result.subjectRgbMismatchCount).toBe(0);
    expect(result.subjectRgbIdentical).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('excludes pixels transparent in both images from the subject-pixel count', () => {
    const a = uniformImage(2, 2, 0, 0, 0, 0);
    const b = cloneImage(a);

    const result = compareAlpha(a, b);

    expect(result.subjectPixelCount).toBe(0);
    expect(result.subjectRgbIdentical).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('passes when alpha differs by exactly epsilon (2) on every pixel', () => {
    const a = uniformImage(2, 2, 10, 20, 30, 100);
    const b = uniformImage(2, 2, 10, 20, 30, 102); // +2 alpha, all 4 pixels differ

    const result = compareAlpha(a, b);

    expect(result.maxAlphaDiff).toBe(2);
    expect(result.alphaWithinEpsilon).toBe(true);
    // 4/4 = 100% > 5% budget, so the ratio guard fails even though epsilon holds.
    expect(result.diffPixelCount).toBe(4);
    expect(result.diffPixelRatio).toBe(1);
    expect(result.diffRatioWithinBudget).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails when a single pixel exceeds the alpha epsilon (diff = 3 > 2)', () => {
    const width = 10;
    const height = 10; // 100 pixels total, so 1 diff pixel = 1% (within the 5% ratio budget)
    const a = uniformImage(width, height, 5, 5, 5, 200);
    const b = cloneImage(a);
    // Bump exactly one pixel's alpha by 3.
    b.data[3] = 203;

    const result = compareAlpha(a, b);

    expect(result.maxAlphaDiff).toBe(3);
    expect(result.alphaWithinEpsilon).toBe(false);
    expect(result.diffPixelCount).toBe(1);
    expect(result.diffPixelRatio).toBeCloseTo(0.01, 5);
    expect(result.diffRatioWithinBudget).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('passes when diff pixels stay under the 5% budget (4/100 = 4%)', () => {
    const width = 10;
    const height = 10;
    const a = uniformImage(width, height, 8, 8, 8, 250);
    const b = cloneImage(a);
    for (let i = 0; i < 4; i++) {
      b.data[i * 4 + 3] = 251; // +1 alpha diff, within epsilon
    }

    const result = compareAlpha(a, b);

    expect(result.diffPixelCount).toBe(4);
    expect(result.diffPixelRatio).toBeCloseTo(0.04, 5);
    expect(result.diffRatioWithinBudget).toBe(true);
    expect(result.alphaWithinEpsilon).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('fails when diff pixels exceed the 5% budget (6/100 = 6%), even within epsilon', () => {
    const width = 10;
    const height = 10;
    const a = uniformImage(width, height, 8, 8, 8, 250);
    const b = cloneImage(a);
    for (let i = 0; i < 6; i++) {
      b.data[i * 4 + 3] = 251; // +1 alpha diff, within epsilon
    }

    const result = compareAlpha(a, b);

    expect(result.diffPixelCount).toBe(6);
    expect(result.diffPixelRatio).toBeCloseTo(0.06, 5);
    expect(result.alphaWithinEpsilon).toBe(true);
    expect(result.diffRatioWithinBudget).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails when RGB differs in a subject pixel (alpha > 0 in both), even with epsilon = 0 default', () => {
    const a = uniformImage(2, 2, 100, 100, 100, 255);
    const b = cloneImage(a);
    b.data[0] = 101; // R channel off by 1 in a fully-opaque pixel

    const result = compareAlpha(a, b);

    expect(result.subjectPixelCount).toBe(4);
    expect(result.subjectRgbMismatchCount).toBe(1);
    expect(result.subjectRgbIdentical).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('does not count RGB differences in pixels transparent in either image', () => {
    const a = uniformImage(2, 2, 100, 100, 100, 255);
    const b = cloneImage(a);
    // Make one pixel transparent in `b` only, and also change its RGB —
    // it must NOT count toward subjectRgbMismatchCount since it is not a
    // subject pixel in both images.
    b.data[3] = 0;
    b.data[0] = 250;

    const result = compareAlpha(a, b);

    expect(result.subjectPixelCount).toBe(3);
    expect(result.subjectRgbMismatchCount).toBe(0);
    expect(result.subjectRgbIdentical).toBe(true);
  });

  it('respects a custom alphaEpsilon option', () => {
    const a = uniformImage(2, 2, 0, 0, 0, 100);
    const b = uniformImage(2, 2, 0, 0, 0, 105); // +5 alpha diff

    expect(compareAlpha(a, b, { alphaEpsilon: 2 }).alphaWithinEpsilon).toBe(false);
    expect(compareAlpha(a, b, { alphaEpsilon: 5 }).alphaWithinEpsilon).toBe(true);
  });

  it('respects a custom maxDiffPixelRatio option', () => {
    const width = 10;
    const height = 10;
    const a = uniformImage(width, height, 0, 0, 0, 200);
    const b = cloneImage(a);
    for (let i = 0; i < 6; i++) {
      b.data[i * 4 + 3] = 201;
    }

    expect(compareAlpha(a, b, { maxDiffPixelRatio: 0.05 }).diffRatioWithinBudget).toBe(false);
    expect(compareAlpha(a, b, { maxDiffPixelRatio: 0.1 }).diffRatioWithinBudget).toBe(true);
  });

  it('respects a custom rgbEpsilon option', () => {
    const a = uniformImage(2, 2, 50, 50, 50, 255);
    const b = cloneImage(a);
    b.data[0] = 51;

    expect(compareAlpha(a, b, { rgbEpsilon: 0 }).subjectRgbIdentical).toBe(false);
    expect(compareAlpha(a, b, { rgbEpsilon: 1 }).subjectRgbIdentical).toBe(true);
  });

  it('throws on dimension mismatch', () => {
    const a = uniformImage(2, 2, 0, 0, 0, 255);
    const b = uniformImage(3, 2, 0, 0, 0, 255);

    expect(() => compareAlpha(a, b)).toThrow(/dimension mismatch/);
  });
});
