import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineAbortError, RmbgError } from 'nukebg-core';

// ---------------------------------------------------------------------------
// Spy/stub on @huggingface/transformers — NEVER download the real RMBG
// model in a test. The mocked `pipeline()` resolves instantly with a fake
// segmenter function that returns a fixed mask.
// ---------------------------------------------------------------------------

const mockSegmenterFn = vi.fn(async (_image: unknown, _opts: unknown) => [
  { mask: { data: new Uint8Array(16).fill(200), width: 4, height: 4 } },
]);
const mockPipelineFactory = vi.fn(async () => mockSegmenterFn);

vi.mock('@huggingface/transformers', () => {
  class MockRawImage {
    data: unknown;
    width: number;
    height: number;
    channels: number;
    constructor(data: unknown, width: number, height: number, channels: number) {
      this.data = data;
      this.width = width;
      this.height = height;
      this.channels = channels;
    }
  }

  return {
    env: {
      cacheDir: '',
      allowLocalModels: true,
      allowRemoteModels: true,
      useBrowserCache: true,
      useFSCache: true,
    },
    pipeline: (...args: unknown[]) => mockPipelineFactory(...(args as [])),
    RawImage: MockRawImage,
  };
});

// Import AFTER vi.mock so the mocked module is used.
const { OnnxNodeRmbgRunner } = await import('../../src/runners/onnx-node-rmbg.js');

const REFINE = {
  spatialPasses: 0,
  spatialRadius: 0,
  morphOpenRadius: 0,
  clusterRatio: 0,
  minClusterSize: 0,
};

describe('OnnxNodeRmbgRunner.segment', () => {
  beforeEach(() => {
    mockSegmenterFn.mockClear();
    mockPipelineFactory.mockClear();
  });

  it('returns a Uint8Array of length width * height', async () => {
    const runner = new OnnxNodeRmbgRunner({ cacheDir: '/tmp/nukebg-test-cache' });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };

    const result = await runner.segment(input, { threshold: 0.5, refine: REFINE });

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(width * height);
  });

  it('rejects with PipelineAbortError when the signal is already aborted', async () => {
    const runner = new OnnxNodeRmbgRunner({ cacheDir: '/tmp/nukebg-test-cache' });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const controller = new AbortController();
    controller.abort();

    await expect(
      runner.segment(input, { threshold: 0.5, refine: REFINE, signal: controller.signal }),
    ).rejects.toBeInstanceOf(PipelineAbortError);
  });
});

describe('OnnxNodeRmbgRunner integrity check', () => {
  beforeEach(() => {
    mockSegmenterFn.mockClear();
    mockPipelineFactory.mockClear();
  });

  it('rejects with RmbgError code RMBG_INTEGRITY_FAILED and EVICTS the corrupted cache file (Fix #3)', async () => {
    // Stub the on-disk read seam to return bytes that do NOT match
    // RMBG_PARAMS.EXPECTED_SHA256 — simulates a corrupted cache entry
    // without touching the real filesystem or network.
    const readFileImpl = vi.fn(async () => Buffer.from('corrupted-model-bytes'));
    const unlinkImpl = vi.fn(async () => undefined);

    const runner = new OnnxNodeRmbgRunner({
      cacheDir: '/tmp/nukebg-test-cache',
      readFileImpl,
      unlinkImpl,
    });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };

    await expect(
      runner.segment(input, { threshold: 0.5, refine: REFINE }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof RmbgError && (e as RmbgError).code === 'RMBG_INTEGRITY_FAILED',
    );
    expect(readFileImpl).toHaveBeenCalled();
    // The poisoned file must be deleted so a fresh run re-fetches clean bytes.
    expect(unlinkImpl).toHaveBeenCalledTimes(1);
  });

  it('disposes the orphaned pipeline session when integrity fails (Fix #4: no native leak)', async () => {
    // The pipeline fully loads a native ORT session before the integrity
    // check runs. If integrity throws BEFORE `this.segmenter` is assigned,
    // that session would leak — the runner must dispose it on the throw path.
    const disposeSpy = vi.fn();
    const disposableSegmenter = Object.assign(
      vi.fn(async () => [{ mask: { data: new Uint8Array(16), width: 4, height: 4 } }]),
      { dispose: disposeSpy },
    );
    mockPipelineFactory.mockResolvedValueOnce(disposableSegmenter);

    const readFileImpl = vi.fn(async () => Buffer.from('corrupted-model-bytes'));
    const unlinkImpl = vi.fn(async () => undefined);

    const runner = new OnnxNodeRmbgRunner({
      cacheDir: '/tmp/nukebg-test-cache-leak',
      readFileImpl,
      unlinkImpl,
    });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };

    await expect(
      runner.segment(input, { threshold: 0.5, refine: REFINE }),
    ).rejects.toBeInstanceOf(RmbgError);
    // The loaded-but-orphaned session must be disposed before rethrow.
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('re-checks the signal after the pipeline resolves and rejects with PipelineAbortError (Fix #6)', async () => {
    const disposeSpy = vi.fn();
    const disposableSegmenter = Object.assign(
      vi.fn(async () => [{ mask: { data: new Uint8Array(16), width: 4, height: 4 } }]),
      { dispose: disposeSpy },
    );
    const controller = new AbortController();
    // Abort while the (mocked) pipeline download is "in flight" so the
    // post-resolve signal re-check fires.
    mockPipelineFactory.mockImplementationOnce(async () => {
      controller.abort();
      return disposableSegmenter;
    });

    const runner = new OnnxNodeRmbgRunner({ cacheDir: '/tmp/nukebg-test-cache-abort' });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };

    await expect(
      runner.segment(input, { threshold: 0.5, refine: REFINE, signal: controller.signal }),
    ).rejects.toBeInstanceOf(PipelineAbortError);
    // The orphaned session must also be disposed on the abort throw path.
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips the check (resolves normally) when the cached file cannot be found', async () => {
    // Simulates the documented v1 fallback: cache-layout resolution
    // missed the file (e.g. not yet on disk, or a future transformers.js
    // version changed its path scheme) — best-effort, does not block.
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const runner = new OnnxNodeRmbgRunner({
      cacheDir: '/tmp/nukebg-test-cache-missing',
      readFileImpl,
    });
    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };

    const result = await runner.segment(input, { threshold: 0.5, refine: REFINE });

    expect(result).toBeInstanceOf(Uint8Array);
    expect(readFileImpl).toHaveBeenCalled();
  });
});
