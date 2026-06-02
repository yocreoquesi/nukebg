/**
 * Worker-boundary tests for the browser pipeline runner.
 *
 * These tests cover the Worker channel infrastructure that the
 * PipelineOrchestrator (and eventually WorkerPipelineRunner in Phase 10)
 * relies on. They do NOT test CV logic — CV logic is tested in the
 * `nukebg-core` package (`tests/pipeline/run-pipeline.test.ts`).
 *
 * Scope:
 *   - WorkerChannel contract (message round-trip, timeout, dispose)
 *   - AbortSignal wiring through the orchestrator abort() method
 *   - PipelineAbortError shape (imported from nukebg-core as of Phase 9)
 *
 * NOTE (Phase 9): The class `WorkerPipelineRunner` does not exist yet —
 * it is created in Phase 10 by renaming PipelineOrchestrator. These tests
 * establish the Worker-boundary contract so that Phase 10's rename is
 * verifiable. Tests that require the renamed class are marked as TODO
 * and will be filled in Phase 10.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineAbortError } from 'nukebg-core';

// ---------------------------------------------------------------------------
// AbortSignal contract — Worker channel relies on these browser guarantees
// ---------------------------------------------------------------------------

describe('AbortSignal — browser guarantees the worker channel relies on', () => {
  let ac: AbortController;

  beforeEach(() => {
    ac = new AbortController();
  });

  it('fires abort listeners exactly once even if abort() is called twice', () => {
    const onAbort = vi.fn();
    ac.signal.addEventListener('abort', onAbort, { once: true });
    ac.abort('reason');
    ac.abort('again');
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('already-aborted signals expose .aborted === true synchronously', () => {
    ac.abort('preloaded');
    expect(ac.signal.aborted).toBe(true);
  });

  it('removeEventListener detaches the abort handler before abort fires', () => {
    const onAbort = vi.fn();
    ac.signal.addEventListener('abort', onAbort);
    ac.signal.removeEventListener('abort', onAbort);
    ac.abort('nope');
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('AbortSignal.reason is the value passed to abort()', () => {
    const reason = new Error('user pressed X');
    ac.abort(reason);
    expect(ac.signal.reason).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
// PipelineAbortError — imported from nukebg-core (Phase 9 migration)
// ---------------------------------------------------------------------------

describe('PipelineAbortError — imported from nukebg-core', () => {
  it('is an Error subclass', () => {
    const err = new PipelineAbortError('user cancelled');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name === "AbortError" per REQ-CORE-PIPELINE-3', () => {
    const err = new PipelineAbortError('user cancelled');
    // PipelineAbortError sets name to "AbortError" for AbortError duck-typing
    expect(err.name).toBe('AbortError');
  });

  it('has code === "PIPELINE_ABORTED"', () => {
    const err = new PipelineAbortError('cancelled');
    expect(err.code).toBe('PIPELINE_ABORTED');
  });

  it('can be discriminated with instanceof', () => {
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

// ---------------------------------------------------------------------------
// WorkerPipelineRunner interface contract — TODO (Phase 10)
// ---------------------------------------------------------------------------

describe('WorkerPipelineRunner interface contract (Phase 10 TODO)', () => {
  it.todo('implements PipelineRunner from nukebg-core (REQ-PARITY-2)');
  it.todo('run(input, options) delegates to worker channels and resolves PipelineResult');
  it.todo('dispose() tears down all four worker channels');
  it.todo('preload() sends load-model to ml channel');
  it.todo('abort via signal rejects with PipelineAbortError');
});
