import { describe, it, expect, vi } from 'vitest';

// Guards issue #327 at the level where it actually broke: the runner accepted
// `opts.refine` and never applied it, so `--precision` only moved
// `rmbgThreshold` and CLI output kept speckle the browser removes.
//
// The pre-existing runner tests all pass an all-zero refine profile, which is
// a no-op — that is why they never noticed. This one uses a real profile and
// a mask the profile is supposed to change.

const W = 40;
const H = 40;

/** Subject square plus a detached 2x2 speck that cluster removal must drop. */
function maskWithSpeck(): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 4; y < 24; y++) {
    for (let x = 4; x < 24; x++) m[y * W + x] = 255;
  }
  for (let y = 33; y < 35; y++) {
    for (let x = 33; x < 35; x++) m[y * W + x] = 255;
  }
  return m;
}

const mockSegmenterFn = vi.fn(async () => [
  { mask: { data: maskWithSpeck(), width: W, height: H } },
]);

vi.mock('@huggingface/transformers', () => {
  class MockRawImage {
    constructor(
      public data: unknown,
      public width: number,
      public height: number,
      public channels: number,
    ) {}
  }
  return {
    env: {
      cacheDir: '',
      allowLocalModels: true,
      allowRemoteModels: true,
      useBrowserCache: true,
      useFSCache: true,
    },
    pipeline: async () => mockSegmenterFn,
    RawImage: MockRawImage,
  };
});

const { OnnxNodeRmbgRunner } = await import('../../src/runners/onnx-node-rmbg.js');

describe('OnnxNodeRmbgRunner applies the refine profile', () => {
  const input = {
    data: new Uint8ClampedArray(W * H * 4),
    width: W,
    height: H,
  };

  it('removes a detached speck when the profile asks for cluster removal', async () => {
    const runner = new OnnxNodeRmbgRunner({ cacheDir: '/tmp/nukebg-refine-test' });

    const out = await runner.segment(input, {
      threshold: 0.5,
      refine: {
        spatialPasses: 1,
        spatialRadius: 2,
        morphOpenRadius: 0,
        clusterRatio: 0.1,
        minClusterSize: 50,
      },
    });

    expect(out[33 * W + 33]).toBe(0); // speck removed
    expect(out[12 * W + 12]).toBeGreaterThan(0); // subject survives
  });

  it('leaves the speck when the profile disables refinement', async () => {
    const runner = new OnnxNodeRmbgRunner({ cacheDir: '/tmp/nukebg-refine-test' });

    const out = await runner.segment(input, {
      threshold: 0.5,
      refine: {
        spatialPasses: 0,
        spatialRadius: 0,
        morphOpenRadius: 0,
        clusterRatio: 0,
        minClusterSize: 0,
      },
    });

    // Proves the two paths genuinely diverge — without this the first test
    // could pass for reasons unrelated to the profile being honoured.
    expect(out[33 * W + 33]).toBeGreaterThan(0);
  });
});
