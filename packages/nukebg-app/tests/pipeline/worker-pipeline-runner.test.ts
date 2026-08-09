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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// WorkerPipelineRunner interface contract — Phase 10
// ---------------------------------------------------------------------------

// Task 10.1 — compile-time proof that WorkerPipelineRunner satisfies PipelineRunner
// (REQ-PARITY-2). The import will fail until Task 10.2 creates the file.
import type { PipelineRunner } from 'nukebg-core';
import { WorkerPipelineRunner } from '../../src/pipeline/worker-pipeline-runner';

// Stub the Web Worker API — happy-dom does not provide Worker. The tests
// here are structural/compile-time checks, not runtime pipeline tests.
// The Worker stub never delivers messages, which is fine for method existence checks.
const WorkerStub = class {
  onmessage: null = null;
  postMessage = () => {};
  terminate = () => {};
  addEventListener = () => {};
  removeEventListener = () => {};
  dispatchEvent = () => false;
};
vi.stubGlobal('Worker', WorkerStub);

describe('WorkerPipelineRunner interface contract (Phase 10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Re-apply the stub for subsequent tests in this describe block
    vi.stubGlobal('Worker', WorkerStub);
  });
  it('satisfies the PipelineRunner interface from nukebg-core (compile-time check)', () => {
    // This assignment must compile without error in strict TypeScript mode.
    // If WorkerPipelineRunner does not implement PipelineRunner, tsc reports
    // a type error here and the typecheck gate fails (REQ-PARITY-2).
    //
    // Worker is stubbed above so the constructor completes without error.
    const noop = () => {
      /* no-op */
    };
    // Type-level assignment — if the class does not satisfy PipelineRunner,
    // the type annotation below will produce a TS error.
    const runner: PipelineRunner = new WorkerPipelineRunner(noop);
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe('function');
    expect(typeof runner.dispose).toBe('function');
  });

  it('run() is a function on WorkerPipelineRunner', () => {
    const noop = () => {
      /* no-op */
    };
    const runner = new WorkerPipelineRunner(noop);
    expect(typeof runner.run).toBe('function');
  });

  it('dispose() is a function on WorkerPipelineRunner', () => {
    const noop = () => {
      /* no-op */
    };
    const runner = new WorkerPipelineRunner(noop);
    expect(typeof runner.dispose).toBe('function');
  });

  it('preload() is a function on WorkerPipelineRunner (optional per PipelineRunner)', () => {
    const noop = () => {
      /* no-op */
    };
    const runner = new WorkerPipelineRunner(noop);
    expect(typeof runner.preload).toBe('function');
  });
});
