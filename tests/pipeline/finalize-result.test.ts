import { describe, it, expect } from 'vitest';
import { finalizePipelineResult } from '../../src/pipeline/finalize-result';
import type { PipelineResult, ImageContentType } from '../../src/types/pipeline';

// ImageData polyfill for happy-dom — happy-dom doesn't ship one.
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

/**
 * `finalizePipelineResult` collapses the working-resolution pipeline
 * output into a camera-ready ImageData. The two contracts these tests
 * pin are the ones that used to be implicit in two separate callers
 * (ar-app + batch-orchestrator) and can drift if anyone refactors:
 *
 *   1. PHOTO / ILLUSTRATION run topology cleanup. SIGNATURE / ICON
 *      pass through unchanged.
 *   2. Output dimensions match the `original` argument, not the
 *      working size on the result.
 */

const W = 16;
const H = 16;

function makeResult(
  contentType: ImageContentType,
  opts: { detached?: boolean; hole?: boolean } = {},
): PipelineResult {
  // 8x8 fully opaque body in the centre of the 16x16 working frame.
  const workingPixels = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    workingPixels[i * 4] = 200;
    workingPixels[i * 4 + 1] = 100;
    workingPixels[i * 4 + 2] = 50;
    workingPixels[i * 4 + 3] = 255;
  }
  const workingAlpha = new Uint8Array(W * H);
  for (let y = 4; y < 12; y++) {
    for (let x = 4; x < 12; x++) workingAlpha[y * W + x] = 255;
  }
  if (opts.detached) {
    // single-pixel orphan blob far from the body — should be dropped
    // for PHOTO / ILLUSTRATION, kept for SIGNATURE / ICON.
    workingAlpha[0] = 255;
  }
  if (opts.hole) {
    // 2x2 hole inside the body — fillSubjectHoles should patch it for
    // PHOTO / ILLUSTRATION.
    workingAlpha[7 * W + 7] = 0;
    workingAlpha[7 * W + 8] = 0;
    workingAlpha[8 * W + 7] = 0;
    workingAlpha[8 * W + 8] = 0;
  }

  return Object.freeze({
    imageData: new ImageData(new Uint8ClampedArray(workingPixels), W, H),
    workingPixels,
    workingAlpha,
    workingWidth: W,
    workingHeight: H,
    watermarkMask: null,
    totalTimeMs: 1,
    watermarkRemoved: false,
    nukedPct: 0,
    stageTiming: {},
    contentType,
  }) as PipelineResult;
}

function makeOriginal(): ImageData {
  // Matches the working size — exercises the same-size compose fast path.
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 200;
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 50;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, W, H);
}

describe('finalizePipelineResult — content-type gating', () => {
  it('PHOTO drops detached orphan blobs', () => {
    const out = finalizePipelineResult(
      makeResult('PHOTO', { detached: true }),
      makeOriginal(),
    );
    expect(out.data[0 * 4 + 3]).toBe(0); // orphan pixel zeroed
    expect(out.data[(8 * W + 8) * 4 + 3]).toBeGreaterThan(0); // body kept
  });

  it('ILLUSTRATION drops detached orphan blobs', () => {
    const out = finalizePipelineResult(
      makeResult('ILLUSTRATION', { detached: true }),
      makeOriginal(),
    );
    expect(out.data[0 * 4 + 3]).toBe(0);
  });

  it('SIGNATURE keeps detached components (legitimate accent dots, separated strokes)', () => {
    const out = finalizePipelineResult(
      makeResult('SIGNATURE', { detached: true }),
      makeOriginal(),
    );
    expect(out.data[0 * 4 + 3]).toBe(255); // orphan survives
  });

  it('ICON keeps detached components (icon sets, multi-glyph)', () => {
    const out = finalizePipelineResult(
      makeResult('ICON', { detached: true }),
      makeOriginal(),
    );
    expect(out.data[0 * 4 + 3]).toBe(255);
  });

  it('PHOTO fills small interior holes (specular-highlight false negatives)', () => {
    const out = finalizePipelineResult(
      makeResult('PHOTO', { hole: true }),
      makeOriginal(),
    );
    expect(out.data[(7 * W + 7) * 4 + 3]).toBe(255);
  });

  it('SIGNATURE preserves interior holes (legitimate counter shapes)', () => {
    const out = finalizePipelineResult(
      makeResult('SIGNATURE', { hole: true }),
      makeOriginal(),
    );
    expect(out.data[(7 * W + 7) * 4 + 3]).toBe(0);
  });
});

describe('finalizePipelineResult — output sizing', () => {
  it('output dimensions match `original`, not the working size', () => {
    // Working at 16x16, "original" at 32x32 — composeAtOriginal upscales.
    const result = makeResult('PHOTO');
    const big = new ImageData(new Uint8ClampedArray(32 * 32 * 4).fill(0), 32, 32);
    // Flag every original pixel as opaque so the upscaled inpaint blend
    // path doesn't read garbage. final-composite uses originalRgba as the
    // base for the output and writes the upscaled alpha into it.
    for (let i = 0; i < 32 * 32; i++) big.data[i * 4 + 3] = 255;
    const out = finalizePipelineResult(result, big);
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
  });
});
