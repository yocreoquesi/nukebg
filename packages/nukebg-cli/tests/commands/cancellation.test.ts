import { describe, it, expect, vi } from 'vitest';
import { PipelineAbortError } from 'nukebg-core';
import type { PipelineResult } from 'nukebg-core';
import { ProcessCommand } from '../../src/commands/process.js';
import { ExitCode } from '../../src/util/exit-codes.js';

// Cancellation was removed end-to-end in the extraction (issue #329):
// ProcessCommand never built an AbortController and never passed `signal`, so
// runPipeline's checkAbort() could not fire and the
// PipelineAbortError -> ExitCode.ABORTED (130) mapping was dead code.
//
// Scope note: this covers cancellation at asynchronous boundaries, which is
// where the long waits are (model download, inference). Synchronous CV still
// blocks the event loop and cannot be interrupted — that needs CV off the
// main thread and is deliberately out of scope here.

function fakeResult(w = 2, h = 2): PipelineResult {
  return {
    output: { data: new Uint8ClampedArray(w * h * 4), width: w, height: h },
    resolvedMode: 'photo',
    durationMs: 1,
    stageTimings: { watermark: 0, rmbg: 1, inpaint: 0, finalize: 0 },
    watermarkRemoved: false,
    watermarkMask: null,
    workingPixels: new Uint8ClampedArray(w * h * 4),
    workingAlpha: new Uint8Array(w * h),
    workingWidth: w,
    workingHeight: h,
    nukedPct: 0,
    contentType: 'PHOTO',
  } as PipelineResult;
}

function makeDeps(overrides: { run?: () => Promise<PipelineResult> } = {}) {
  const writeFileImpl = vi.fn(async () => undefined);
  // `| undefined` is explicit because the package runs with
  // exactOptionalPropertyTypes: recording "the signal arrived as undefined"
  // is exactly what this fixture needs to be able to express.
  const seen: { signal?: AbortSignal | undefined } = {};
  return {
    writeFileImpl,
    seen,
    deps: {
      readFileImpl: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      writeFileImpl,
      stderrWrite: vi.fn(),
      stdoutWrite: vi.fn(),
      assertAccepted: vi.fn(async () => undefined),
      codec: {
        decode: vi.fn(async () => ({
          image: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
          originalWidth: 2,
          originalHeight: 2,
          wasDownsampled: false,
        })),
        encode: vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      createRmbgRunner: vi.fn(() => ({
        segment: vi.fn(),
        dispose: vi.fn(async () => undefined),
      })),
      createLamaRunner: vi.fn(() => ({
        inpaint: vi.fn(),
        dispose: vi.fn(async () => undefined),
      })),
      createPipelineRunner: vi.fn(() => ({
        preload: vi.fn(async () => undefined),
        run: overrides.run
          ? overrides.run
          : vi.fn(async (_input: unknown, opts: { signal?: AbortSignal }) => {
              seen.signal = opts.signal;
              return fakeResult();
            }),
        dispose: vi.fn(async () => undefined),
      })),
    },
  };
}

describe('ProcessCommand cancellation', () => {
  it('forwards the caller signal into the pipeline options', async () => {
    const { deps, seen } = makeDeps();
    const controller = new AbortController();

    await new ProcessCommand(deps as never).execute({
      input: 'in.png',
      acceptNonCommercial: true,
      signal: controller.signal,
    });

    // The whole defect was that this arrived undefined.
    expect(seen.signal).toBe(controller.signal);
  });

  it('exits ABORTED (130) when the pipeline reports an abort', async () => {
    const { deps } = makeDeps({
      run: async () => {
        throw new PipelineAbortError('aborted');
      },
    });

    const code = await new ProcessCommand(deps as never).execute({
      input: 'in.png',
      acceptNonCommercial: true,
    });

    expect(code).toBe(ExitCode.ABORTED);
    expect(code).toBe(130);
  });

  it('writes no output file when cancelled before encoding', async () => {
    const controller = new AbortController();
    const { deps, writeFileImpl } = makeDeps({
      run: async () => {
        // Cancelled while the pipeline was running.
        controller.abort();
        return fakeResult();
      },
    });

    const code = await new ProcessCommand(deps as never).execute({
      input: 'in.png',
      acceptNonCommercial: true,
      signal: controller.signal,
    });

    expect(code).toBe(ExitCode.ABORTED);
    // A partially-processed run must not leave a file behind.
    expect(writeFileImpl).not.toHaveBeenCalled();
  });
});
