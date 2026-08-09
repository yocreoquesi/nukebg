import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import type { RunnerBundle } from '../../src/pipeline/run-pipeline.js';
import { createImageDataLike } from '../../src/types/image-data-like.js';
import type { ImageDataLike } from '../../src/types/image-data-like.js';
import { PipelineTimeoutError } from '../../src/pipeline/errors.js';
import { PIPELINE_TIMEOUTS } from '../../src/pipeline/constants.js';
import type { LamaRunner } from '../../src/runners/lama-runner.js';
import type { RmbgRunner } from '../../src/runners/rmbg-runner.js';

// The extraction dropped every timeout the browser orchestrator had, so a
// stalled model fetch hung a run forever with no output and no exit
// (issue #328). `git grep -i timeout` over both new packages returned nothing.
//
// What can actually be bounded is the asynchronous stages — a Promise.race
// cannot interrupt synchronous CV on the same thread — and that is exactly
// where the observed hang lives.

function makeImage(w = 16, h = 16): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 120;
    data[i * 4 + 1] = 120;
    data[i * 4 + 2] = 120;
    data[i * 4 + 3] = 255;
  }
  return createImageDataLike(data, w, h);
}

/** An RMBG runner whose segment() never settles — a stalled model fetch. */
function makeHangingRmbg(): RmbgRunner {
  return {
    segment: () => new Promise<Uint8Array>(() => {}),
    async dispose() {},
  };
}

function makeFastRmbg(): RmbgRunner {
  return {
    async segment(input) {
      return new Uint8Array(input.width * input.height).fill(200);
    },
    async dispose() {},
  };
}

function makeFastLama(): LamaRunner {
  return {
    async inpaint(input) {
      return new Uint8ClampedArray(input.width * input.height * 4).fill(255);
    },
    async dispose() {},
  };
}

describe('runPipeline time budgets', () => {
  it('rejects with PipelineTimeoutError when RMBG never settles', async () => {
    const runners: RunnerBundle = { rmbg: makeHangingRmbg() };

    await expect(
      runPipeline(makeImage(), runners, {
        mode: 'photo',
        skipWatermark: true,
        timeouts: { RMBG_MS: 40 },
      }),
    ).rejects.toBeInstanceOf(PipelineTimeoutError);
  });

  it('names the stage and the budget on the error', async () => {
    const runners: RunnerBundle = { rmbg: makeHangingRmbg() };

    const err = await runPipeline(makeImage(), runners, {
      mode: 'photo',
      skipWatermark: true,
      timeouts: { RMBG_MS: 40 },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PipelineTimeoutError);
    const timeout = err as PipelineTimeoutError;
    expect(timeout.stage).toBe('RMBG segmentation');
    expect(timeout.timeoutMs).toBe(40);
    expect(timeout.code).toBe('PIPELINE_TIMEOUT');
  });

  it('does not fire when the stage completes inside its budget', async () => {
    const runners: RunnerBundle = { rmbg: makeFastRmbg(), lama: makeFastLama() };

    await expect(
      runPipeline(makeImage(), runners, {
        mode: 'photo',
        skipWatermark: true,
        timeouts: { RMBG_MS: 10_000 },
      }),
    ).resolves.toBeDefined();
  });

  it('treats Infinity as opting out of a budget', async () => {
    const runners: RunnerBundle = { rmbg: makeFastRmbg() };

    await expect(
      runPipeline(makeImage(), runners, {
        mode: 'photo',
        skipWatermark: true,
        timeouts: { RMBG_MS: Infinity },
      }),
    ).resolves.toBeDefined();
  });

  it('trips the wall-clock budget at a stage boundary', async () => {
    const runners: RunnerBundle = { rmbg: makeFastRmbg() };

    // Zero budget: already exceeded by the time the first boundary check runs.
    await expect(
      runPipeline(makeImage(), runners, {
        mode: 'photo',
        skipWatermark: true,
        timeouts: { WALL_CLOCK_MS: -1 },
      }),
    ).rejects.toBeInstanceOf(PipelineTimeoutError);
  });

  it('ships defaults carried over from the browser orchestrator', () => {
    // Regression guard: these were 300s/300s/20min before the extraction and
    // silently became "no limit at all".
    expect(PIPELINE_TIMEOUTS.RMBG_MS).toBe(300_000);
    expect(PIPELINE_TIMEOUTS.LAMA_MS).toBe(300_000);
    expect(PIPELINE_TIMEOUTS.WALL_CLOCK_MS).toBe(20 * 60_000);
  });
});
