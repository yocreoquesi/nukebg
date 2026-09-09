import { describe, it, expect, vi } from 'vitest';
import { AsyncCallDedupe } from '../../src/lib/async-call-dedupe';

/**
 * Behavioural tests for `AsyncCallDedupe` (in-flight async call dedupe).
 *
 * This is the extracted, directly-testable core of the ml.worker.ts
 * `loadModel()` fix: two concurrent `loadModel()` calls for the same
 * modelId must invoke `transformers.pipeline()` exactly ONCE instead of
 * starting two independent ~45MB downloads. `ml.worker.ts` itself can't
 * be unit-tested here — it imports `@huggingface/transformers` dynamically
 * and relies on worker-global `self.postMessage`/`onmessage`, which the
 * rest of the test suite deliberately avoids driving directly (see
 * tests/pipeline/model-integrity.test.ts's comment on the same point) —
 * so this test exercises the dedupe mechanism in isolation instead.
 */

describe('AsyncCallDedupe', () => {
  it('invokes factory() only once for two concurrent calls with the same key, and both callers resolve', async () => {
    const dedupe = new AsyncCallDedupe<string>();
    const factory = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('loaded'), 10);
        }),
    );

    const callA = dedupe.run('model-x', factory);
    const callB = dedupe.run('model-x', factory);

    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(resultA).toBe('loaded');
    expect(resultB).toBe('loaded');
  });

  it('clears the in-flight entry once the call settles, so a later call for the same key starts a fresh factory() run', async () => {
    const dedupe = new AsyncCallDedupe<string>();
    const factory = vi.fn(async () => 'loaded');

    await dedupe.run('model-x', factory);
    expect(dedupe.size).toBe(0);

    await dedupe.run('model-x', factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on FAILURE too, so a failed call can be retried instead of permanently caching a rejection', async () => {
    const dedupe = new AsyncCallDedupe<string>();
    let attempt = 0;
    const factory = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('network error')) : Promise.resolve('loaded');
    });

    await expect(dedupe.run('model-x', factory)).rejects.toThrow('network error');
    expect(dedupe.size).toBe(0);

    await expect(dedupe.run('model-x', factory)).resolves.toBe('loaded');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('a joiner that arrives while a call is in flight also rejects when the initiator fails, without calling factory() itself', async () => {
    const dedupe = new AsyncCallDedupe<string>();
    let rejectFirst!: (err: Error) => void;
    const factory = vi.fn(
      () =>
        new Promise<string>((_, reject) => {
          rejectFirst = reject;
        }),
    );

    const callA = dedupe.run('model-x', factory);
    const callB = dedupe.run('model-x', factory);

    rejectFirst(new Error('boom'));

    await expect(callA).rejects.toThrow('boom');
    await expect(callB).rejects.toThrow('boom');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('runs independent factories for different keys concurrently', async () => {
    const dedupe = new AsyncCallDedupe<string>();
    const factoryX = vi.fn(async () => 'x-loaded');
    const factoryY = vi.fn(async () => 'y-loaded');

    const [resultX, resultY] = await Promise.all([
      dedupe.run('model-x', factoryX),
      dedupe.run('model-y', factoryY),
    ]);

    expect(factoryX).toHaveBeenCalledTimes(1);
    expect(factoryY).toHaveBeenCalledTimes(1);
    expect(resultX).toBe('x-loaded');
    expect(resultY).toBe('y-loaded');
  });
});
