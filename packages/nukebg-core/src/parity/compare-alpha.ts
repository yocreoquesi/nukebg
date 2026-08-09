import type { ImageDataLike } from '../types/image-data-like.js';

// ---------------------------------------------------------------------------
// compareAlpha
// ---------------------------------------------------------------------------
//
// Pure pixel-comparison helper backing the browser<->Node parity test
// (REQ-PARITY-1 in openspec/changes/extract-core-cli/specs/browser-app-parity.md).
// Deliberately dependency-free and runtime-agnostic so it can be unit
// tested directly, independent of any pipeline runner, model, or fixture.
//
// Default thresholds mirror REQ-PARITY-1:
//   - alpha channel values may differ by at most epsilon = 2 (8-bit scale)
//     for ANY pixel;
//   - the number of pixels with a non-zero alpha difference must stay
//     below 5% of the total pixel count;
//   - RGB channel values in "subject" pixels (alpha > 0 in BOTH images)
//     must be identical (epsilon = 0), since they pass through lossless
//     compositing and any divergence there is a real bug, not ONNX
//     backend rounding noise.

export interface CompareAlphaOptions {
  /** Max allowed per-pixel alpha difference (0-255 scale). Default 2. */
  readonly alphaEpsilon?: number;
  /** Max allowed fraction of pixels with a non-zero alpha diff. Default 0.05 (5%). */
  readonly maxDiffPixelRatio?: number;
  /** Max allowed per-channel RGB difference in subject pixels. Default 0. */
  readonly rgbEpsilon?: number;
}

export interface CompareAlphaResult {
  readonly totalPixels: number;
  /** Largest |alphaA - alphaB| observed across all pixels. */
  readonly maxAlphaDiff: number;
  /** Count of pixels where alpha differs by more than 0. */
  readonly diffPixelCount: number;
  /** diffPixelCount / totalPixels. */
  readonly diffPixelRatio: number;
  /** true if maxAlphaDiff <= alphaEpsilon. */
  readonly alphaWithinEpsilon: boolean;
  /** true if diffPixelRatio < maxDiffPixelRatio. */
  readonly diffRatioWithinBudget: boolean;
  /** Pixels where alpha > 0 in BOTH images. */
  readonly subjectPixelCount: number;
  /** Subject pixels where any RGB channel differs by more than rgbEpsilon. */
  readonly subjectRgbMismatchCount: number;
  /** true if subjectRgbMismatchCount === 0. */
  readonly subjectRgbIdentical: boolean;
  /** true if all three thresholds above are satisfied. */
  readonly passed: boolean;
}

const DEFAULT_ALPHA_EPSILON = 2;
const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.05;
const DEFAULT_RGB_EPSILON = 0;

/**
 * Compare the alpha channels (and subject-pixel RGB channels) of two
 * RGBA images of identical dimensions. Pure function — no I/O, no model
 * inference, no runtime dependency. See REQ-PARITY-1 for the thresholds
 * this backs.
 */
export function compareAlpha(
  a: ImageDataLike,
  b: ImageDataLike,
  options: CompareAlphaOptions = {}
): CompareAlphaResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `compareAlpha: dimension mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`
    );
  }

  const alphaEpsilon = options.alphaEpsilon ?? DEFAULT_ALPHA_EPSILON;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const rgbEpsilon = options.rgbEpsilon ?? DEFAULT_RGB_EPSILON;

  const { width, height } = a;
  const totalPixels = width * height;
  const dataA = a.data;
  const dataB = b.data;

  let maxAlphaDiff = 0;
  let diffPixelCount = 0;
  let subjectPixelCount = 0;
  let subjectRgbMismatchCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const alphaA = dataA[idx + 3]!;
    const alphaB = dataB[idx + 3]!;
    const alphaDiff = Math.abs(alphaA - alphaB);

    if (alphaDiff > maxAlphaDiff) maxAlphaDiff = alphaDiff;
    if (alphaDiff > 0) diffPixelCount++;

    if (alphaA > 0 && alphaB > 0) {
      subjectPixelCount++;
      const rDiff = Math.abs(dataA[idx]! - dataB[idx]!);
      const gDiff = Math.abs(dataA[idx + 1]! - dataB[idx + 1]!);
      const bDiff = Math.abs(dataA[idx + 2]! - dataB[idx + 2]!);
      if (rDiff > rgbEpsilon || gDiff > rgbEpsilon || bDiff > rgbEpsilon) {
        subjectRgbMismatchCount++;
      }
    }
  }

  const diffPixelRatio = totalPixels === 0 ? 0 : diffPixelCount / totalPixels;
  const alphaWithinEpsilon = maxAlphaDiff <= alphaEpsilon;
  const diffRatioWithinBudget = diffPixelRatio < maxDiffPixelRatio;
  const subjectRgbIdentical = subjectRgbMismatchCount === 0;

  return {
    totalPixels,
    maxAlphaDiff,
    diffPixelCount,
    diffPixelRatio,
    alphaWithinEpsilon,
    diffRatioWithinBudget,
    subjectPixelCount,
    subjectRgbMismatchCount,
    subjectRgbIdentical,
    passed: alphaWithinEpsilon && diffRatioWithinBudget && subjectRgbIdentical,
  };
}
