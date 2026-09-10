import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The main-thread RMBG loader releases its pipeline when integrity fails.
 *
 * Review finding on #398. That commit gave this loader the verification the
 * worker already had, but not the worker's cleanup: on a failed check
 * `ml.worker.ts` disposes the pipeline it just built before rethrowing, and
 * this path did not.
 *
 * It matters because this path is reachable from three buttons — Reprocess,
 * Crop and Refine — so a user facing a corrupt cached blob can retry it. Each
 * attempt re-downloads ~45MB and, without the dispose, strands another live
 * ONNX/WASM session: `pipe` is a local that goes out of scope with its
 * session still allocated. That is precisely the OOM the worker's eviction
 * loop exists to prevent, on a button the user can press repeatedly.
 */

const pipelineDispose = vi.fn();
const pipelineFactory = vi.fn(() =>
  Promise.resolve(Object.assign(vi.fn(), { dispose: pipelineDispose })),
);

vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, allowRemoteModels: false },
  RawImage: class {},
  pipeline: (...args: unknown[]) => pipelineFactory(...(args as [])),
}));

const verify = vi.fn();
vi.mock('../../src/lib/verify-rmbg-integrity', () => ({
  verifyRmbgIntegrity: (...args: unknown[]) => verify(...(args as [])),
}));

import { createRmbg14Loader } from '../../src/refine/loaders/rmbg14';

describe('rmbg14 loader — integrity failure cleanup', () => {
  beforeEach(() => {
    pipelineDispose.mockClear();
    pipelineFactory.mockClear();
    verify.mockReset();
  });

  it('disposes the pipeline it just built when verification throws', async () => {
    verify.mockRejectedValue(new Error('RMBG-1.4 hash mismatch'));

    await expect(createRmbg14Loader().warmup()).rejects.toThrow(/hash mismatch/);

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineDispose, 'the failed pipeline leaked its ONNX session').toHaveBeenCalledTimes(1);
  });

  it('a retry after a failure builds a fresh pipeline rather than reusing one', async () => {
    verify.mockRejectedValue(new Error('RMBG-1.4 hash mismatch'));
    const loader = createRmbg14Loader();

    await expect(loader.warmup()).rejects.toThrow();
    await expect(loader.warmup()).rejects.toThrow();

    // Two attempts, two builds, two disposals — nothing accumulates.
    expect(pipelineFactory).toHaveBeenCalledTimes(2);
    expect(pipelineDispose).toHaveBeenCalledTimes(2);
  });

  it('keeps the pipeline when verification passes', async () => {
    verify.mockResolvedValue(undefined);

    await createRmbg14Loader().warmup();

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineDispose, 'disposed a pipeline that verified fine').not.toHaveBeenCalled();
  });

  it('verifies before exposing the pipeline, not after', async () => {
    const order: string[] = [];
    verify.mockImplementation(() => {
      order.push('verify');
      return Promise.resolve();
    });
    pipelineFactory.mockImplementation(() => {
      order.push('build');
      return Promise.resolve(Object.assign(vi.fn(), { dispose: pipelineDispose }));
    });

    const loader = createRmbg14Loader();
    await loader.warmup();

    expect(order).toEqual(['build', 'verify']);
  });
});
