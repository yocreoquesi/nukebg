import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PipelineAbortError, RmbgError } from 'nukebg-core';
import { WorkerPipelineRunner } from '../../src/runners/worker-pipeline-runner.js';
import type { PipelineWorkerMessage } from '../../src/runners/pipeline.worker.js';

// Unit-level: the protocol between the main thread and the worker. The real
// built worker is covered separately in worker-bundle.test.ts, because a fake
// here cannot catch the failure that actually matters — the worker file not
// resolving from the bundle.

class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0);
  emitMessage(msg: PipelineWorkerMessage): void {
    this.emit('message', msg);
  }
}

function resultMessage(): PipelineWorkerMessage {
  return {
    kind: 'result',
    result: {
      output: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      resolvedMode: 'photo',
      durationMs: 5,
      stageTimings: { watermark: 0, rmbg: 5, inpaint: 0, finalize: 0 },
      watermarkRemoved: false,
      watermarkMask: null,
      workingPixels: new Uint8ClampedArray(16),
      workingAlpha: new Uint8Array(4),
      workingWidth: 2,
      workingHeight: 2,
      nukedPct: 0,
      contentType: 'PHOTO',
    },
  };
}

const image = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

function runnerWith(worker: FakeWorker): WorkerPipelineRunner {
  return new WorkerPipelineRunner({
    workerPath: '/fake/pipeline.worker.js',
    spawn: () => worker as never,
  });
}

describe('WorkerPipelineRunner', () => {
  it('resolves with the hydrated result', async () => {
    const worker = new FakeWorker();
    const p = runnerWith(worker).run(image);
    queueMicrotask(() => worker.emitMessage(resultMessage()));

    const result = await p;
    expect(result.resolvedMode).toBe('photo');
    expect(result.output.width).toBe(2);
  });

  it('streams stage events through onStage', async () => {
    const worker = new FakeWorker();
    const seen: string[] = [];
    const p = runnerWith(worker).run(image, {
      onStage: (e) => seen.push(`${e.stage}:${e.status}`),
    });
    queueMicrotask(() => {
      worker.emitMessage({ kind: 'stage', event: { stage: 'ml-segmentation', status: 'running' } });
      worker.emitMessage(resultMessage());
    });

    await p;
    expect(seen).toContain('ml-segmentation:running');
  });

  it('rebuilds the error class so exit-code mapping still works', async () => {
    const worker = new FakeWorker();
    const p = runnerWith(worker).run(image);
    queueMicrotask(() =>
      worker.emitMessage({
        kind: 'error',
        name: 'RmbgError',
        message: 'model download failed',
        code: 'RMBG_DOWNLOAD_FAILED',
      }),
    );

    // Errors do not survive structured clone with their prototype. If this
    // regressed, exitCodeFor would fall through to 70 for everything.
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RmbgError);
    expect((err as RmbgError).code).toBe('RMBG_DOWNLOAD_FAILED');
  });

  it('terminates the worker on abort instead of waiting for it', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const p = runnerWith(worker).run(image, { signal: controller.signal });

    controller.abort();

    await expect(p).rejects.toBeInstanceOf(PipelineAbortError);
    // The whole point of #329: immediate, not cooperative.
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const spawn = vi.fn();

    await expect(
      new WorkerPipelineRunner({ workerPath: '/fake/w.js', spawn: spawn as never }).run(image, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(PipelineAbortError);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('surfaces a non-zero worker exit as an error', async () => {
    const worker = new FakeWorker();
    const p = runnerWith(worker).run(image);
    queueMicrotask(() => worker.emit('exit', 1));

    await expect(p).rejects.toThrow(/exited with code 1/);
  });
});
