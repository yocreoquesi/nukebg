import { describe, it, expect } from 'vitest';
import { finalizePipelineResult } from '../../src/pipeline/finalize-result';
import type { WorkingResult } from '../../src/pipeline/finalize-result';
import { createImageDataLike } from '../../src/types/image-data-like';
import type { ImageDataLike } from '../../src/types/image-data-like';
import type { ImageContentType } from '../../src/types/pipeline-result';

// Core runs in Node — NO ImageData global, NO polyfill.
// All inputs are plain ImageDataLike objects; outputs must also be plain.

const W = 16;
const H = 16;

function makeResult(
  contentType: ImageContentType,
  opts: { detached?: boolean; hole?: boolean } = {},
): WorkingResult {
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
    workingAlpha[0] = 255;
  }
  if (opts.hole) {
    workingAlpha[7 * W + 7] = 0;
    workingAlpha[7 * W + 8] = 0;
    workingAlpha[8 * W + 7] = 0;
    workingAlpha[8 * W + 8] = 0;
  }

  return {
    workingPixels,
    workingAlpha,
    workingWidth: W,
    workingHeight: H,
    watermarkMask: null,
    contentType,
  };
}

function makeOriginal(): ImageDataLike {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 200;
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 50;
    data[i * 4 + 3] = 255;
  }
  return createImageDataLike(data, W, H);
}

// ── REQ-CORE-PIPELINE-2 compliance: must return plain ImageDataLike ──

describe('finalizePipelineResult — returns plain ImageDataLike (not ImageData instance)', () => {
  it('return value satisfies ImageDataLike structural contract', () => {
    const out = finalizePipelineResult(makeResult('PHOTO'), makeOriginal());
    expect(out).toHaveProperty('data');
    expect(out).toHaveProperty('width', W);
    expect(out).toHaveProperty('height', H);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('return value is NOT an ImageData instance (plain object)', () => {
    const out = finalizePipelineResult(makeResult('PHOTO'), makeOriginal());
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

// ── Behavioural tests ──

describe('finalizePipelineResult — content-type gating (core)', () => {
  it('PHOTO drops detached orphan blobs', () => {
    const out = finalizePipelineResult(makeResult('PHOTO', { detached: true }), makeOriginal());
    expect(out.data[0 * 4 + 3]).toBe(0);
    expect(out.data[(8 * W + 8) * 4 + 3]).toBeGreaterThan(0);
  });

  it('SIGNATURE keeps detached components (legitimate accent dots)', () => {
    const out = finalizePipelineResult(
      makeResult('SIGNATURE', { detached: true }),
      makeOriginal(),
    );
    expect(out.data[0 * 4 + 3]).toBe(255);
  });

  it('ICON keeps detached components (icon sets, multi-glyph)', () => {
    const out = finalizePipelineResult(makeResult('ICON', { detached: true }), makeOriginal());
    expect(out.data[0 * 4 + 3]).toBe(255);
  });

  it('PHOTO fills small interior holes (specular-highlight false negatives)', () => {
    const out = finalizePipelineResult(makeResult('PHOTO', { hole: true }), makeOriginal());
    expect(out.data[(7 * W + 7) * 4 + 3]).toBe(255);
  });

  it('SIGNATURE preserves interior holes (legitimate counter shapes)', () => {
    const out = finalizePipelineResult(makeResult('SIGNATURE', { hole: true }), makeOriginal());
    expect(out.data[(7 * W + 7) * 4 + 3]).toBe(0);
  });
});

describe('finalizePipelineResult — output sizing (core)', () => {
  it('output dimensions match `original`, not the working size', () => {
    const result = makeResult('PHOTO');
    const bigData = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) bigData[i * 4 + 3] = 255;
    const big = createImageDataLike(bigData, 32, 32);
    const out = finalizePipelineResult(result, big);
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
  });
});
