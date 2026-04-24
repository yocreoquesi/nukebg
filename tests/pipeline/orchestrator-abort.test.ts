import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineAbortError } from '../../src/pipeline/orchestrator';

/**
 * Orchestrator abort contract.
 *
 * Cannot instantiate the real PipelineOrchestrator in happy-dom (no
 * Worker constructor), so these tests cover the abort error shape and
 * AbortSignal contract callers rely on.
 */

describe('PipelineAbortError', () => {
  it('is an Error subclass with the expected name', () => {
    const err = new PipelineAbortError('user cancelled');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PipelineAbortError');
    expect(err.message).toBe('user cancelled');
  });

  it('can be discriminated with instanceof in caller code', () => {
    const err: unknown = new PipelineAbortError('new image dropped');
    let handled = false;
    try {
      throw err;
    } catch (e) {
      if (e instanceof PipelineAbortError) handled = true;
    }
    expect(handled).toBe(true);
  });
});

describe('AbortSignal behaviour the orchestrator relies on', () => {
  let ac: AbortController;
  beforeEach(() => {
    ac = new AbortController();
  });

  it('fires abort listeners exactly once', () => {
    const onAbort = vi.fn();
    ac.signal.addEventListener('abort', onAbort, { once: true });
    ac.abort('reason');
    ac.abort('again');
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('already-aborted signals expose reason synchronously', () => {
    ac.abort('preloaded');
    expect(ac.signal.aborted).toBe(true);
    expect(String(ac.signal.reason)).toContain('preloaded');
  });

  it('removeEventListener detaches the abort handler', () => {
    const onAbort = vi.fn();
    ac.signal.addEventListener('abort', onAbort);
    ac.signal.removeEventListener('abort', onAbort);
    ac.abort('nope');
    expect(onAbort).not.toHaveBeenCalled();
  });
});
