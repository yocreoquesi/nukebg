import { describe, it, expect } from 'vitest';
import { segmentWithBboxRefine } from '../../exploration/bbox-refine';
import type { ModelLoader, SegmentInput, SegmentOutput } from '../../exploration/loaders/types';

function buildLoader(
  segmentFn: (input: SegmentInput) => SegmentOutput,
  label = 'fake',
): { loader: ModelLoader; calls: SegmentInput[] } {
  const calls: SegmentInput[] = [];
  const loader: ModelLoader = {
    id: 'rmbg-1.4',
    label,
    approxDownloadMb: 0,
    requiresWebGpu: false,
    warmup: async () => {},
    segment: async (input) => {
      calls.push(input);
      return segmentFn(input);
    },
    dispose: async () => {},
  };
  return { loader, calls };
}

function rgba(w: number, h: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = 100;
    buf[i * 4 + 1] = 100;
    buf[i * 4 + 2] = 100;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe('segmentWithBboxRefine', () => {
  it('returns coarse output when no subject is detected', async () => {
    const { loader, calls } = buildLoader(() => ({
      alpha: new Uint8Array(8 * 8),
      width: 8,
      height: 8,
      latencyMs: 1,
      backend: 'wasm',
    }));

    const result = await segmentWithBboxRefine(loader, {
      pixels: rgba(8, 8),
      width: 8,
      height: 8,
    });

    expect(result.refined).toBe(false);
    expect(result.bbox).toBeNull();
    expect(calls.length).toBe(1);
  });

  it('skips refine when subject already fills the frame', async () => {
    const full = new Uint8Array(8 * 8).fill(255);
    const { loader, calls } = buildLoader(() => ({
      alpha: full,
      width: 8,
      height: 8,
      latencyMs: 1,
      backend: 'wasm',
    }));

    const result = await segmentWithBboxRefine(loader, {
      pixels: rgba(8, 8),
      width: 8,
      height: 8,
    });

    expect(result.refined).toBe(false);
    expect(result.bbox).not.toBeNull();
    expect(calls.length).toBe(1);
  });

  it('runs a second pass on the bbox crop and places alpha back', async () => {
    const coarse = new Uint8Array(16 * 16);
    // Small subject in the top-left corner (4×4 block)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        coarse[y * 16 + x] = 255;
      }
    }

    const { loader, calls } = buildLoader((input) => {
      if (input.width === 16 && input.height === 16) {
        return { alpha: coarse, width: 16, height: 16, latencyMs: 1, backend: 'wasm' };
      }
      // Fine pass — return full 255 on the whole crop
      const fine = new Uint8Array(input.width * input.height).fill(200);
      return { alpha: fine, width: input.width, height: input.height, latencyMs: 1, backend: 'wasm' };
    });

    const result = await segmentWithBboxRefine(loader, {
      pixels: rgba(16, 16),
      width: 16,
      height: 16,
    });

    expect(result.refined).toBe(true);
    expect(result.bbox).not.toBeNull();
    expect(calls.length).toBe(2);

    // Fine alpha is placed within the bbox region, zero elsewhere.
    const bbox = result.bbox!;
    expect(bbox.x).toBeLessThanOrEqual(0);
    expect(bbox.y).toBeLessThanOrEqual(0);
    // Inside bbox → fine value (200)
    expect(result.alpha[0]).toBe(200);
    // Outside the expanded bbox → zero
    expect(result.alpha[15 * 16 + 15]).toBe(0);
  });

  it('reports backend from the fine pass when it runs', async () => {
    const coarse = new Uint8Array(16 * 16);
    for (let i = 0; i < 10; i++) coarse[i] = 255;

    const { loader } = buildLoader((input) => ({
      alpha:
        input.width === 16
          ? coarse
          : new Uint8Array(input.width * input.height).fill(128),
      width: input.width,
      height: input.height,
      latencyMs: 1,
      backend: input.width === 16 ? 'wasm' : 'webgpu',
    }));

    const result = await segmentWithBboxRefine(loader, {
      pixels: rgba(16, 16),
      width: 16,
      height: 16,
    });

    expect(result.refined).toBe(true);
    expect(result.backend).toBe('webgpu');
  });
});
