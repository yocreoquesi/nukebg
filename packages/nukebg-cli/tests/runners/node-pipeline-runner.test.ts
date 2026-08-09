import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LamaRunner, PipelineResult, RmbgRunner } from 'nukebg-core';

// ---------------------------------------------------------------------------
// Mock nukebg-core's `runPipeline` — NodePipelineRunner is a thin adapter
// that wires Node-side runners into the core orchestrator. This test
// verifies the WIRING (bundle shape, delegation, return value), not the
// pipeline algorithm itself (already contract-tested in
// `packages/nukebg-core/tests/pipeline/run-pipeline.test.ts`). Keep the rest
// of the core export surface intact via `importOriginal`.
// ---------------------------------------------------------------------------

const mockRunPipeline = vi.fn();

vi.mock('nukebg-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nukebg-core')>();
  return {
    ...actual,
    runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
  };
});

// Import AFTER vi.mock so the mocked module is used.
const { NodePipelineRunner } = await import('../../src/runners/node-pipeline-runner.js');

function makeStubRmbg(): RmbgRunner {
  return {
    load: vi.fn(async () => undefined),
    segment: vi.fn(async () => new Uint8Array(4)),
    dispose: vi.fn(async () => undefined),
  };
}

function makeStubLama(): LamaRunner {
  return {
    load: vi.fn(async () => undefined),
    inpaint: vi.fn(async () => new Uint8ClampedArray(16)),
    dispose: vi.fn(async () => undefined),
  };
}

describe('NodePipelineRunner', () => {
  beforeEach(() => {
    mockRunPipeline.mockReset();
  });

  it('run(image, options) delegates to core runPipeline and returns its PipelineResult', async () => {
    const fakeResult = { output: {}, resolvedMode: 'photo' } as unknown as PipelineResult;
    mockRunPipeline.mockResolvedValueOnce(fakeResult);

    const rmbgRunner = makeStubRmbg();
    const lamaRunner = makeStubLama();
    const runner = new NodePipelineRunner({ rmbgRunner, lamaRunner });

    const input = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const options = { mode: 'photo' as const };

    const result = await runner.run(input, options);

    expect(result).toBe(fakeResult);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      input,
      { rmbg: rmbgRunner, lama: lamaRunner },
      options,
    );
  });

  it('dispose() calls rmbgRunner.dispose() and lamaRunner.dispose()', async () => {
    const rmbgRunner = makeStubRmbg();
    const lamaRunner = makeStubLama();
    const runner = new NodePipelineRunner({ rmbgRunner, lamaRunner });

    await runner.dispose();

    expect(rmbgRunner.dispose).toHaveBeenCalledTimes(1);
    expect(lamaRunner.dispose).toHaveBeenCalledTimes(1);
  });

  it('preload() calls rmbgRunner.load()', async () => {
    const rmbgRunner = makeStubRmbg();
    const runner = new NodePipelineRunner({ rmbgRunner });

    await runner.preload();

    expect(rmbgRunner.load).toHaveBeenCalledTimes(1);
  });

  it('excludes lama from the bundle when options.skipWatermark is true (REQ-CORE-RUNNERS-2)', async () => {
    const fakeResult = { output: {}, resolvedMode: 'photo' } as unknown as PipelineResult;
    mockRunPipeline.mockResolvedValueOnce(fakeResult);

    const rmbgRunner = makeStubRmbg();
    const lamaRunner = makeStubLama();
    const runner = new NodePipelineRunner({ rmbgRunner, lamaRunner });

    const input = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const options = { skipWatermark: true as const };

    await runner.run(input, options);

    expect(mockRunPipeline).toHaveBeenCalledWith(input, { rmbg: rmbgRunner }, options);
    expect(lamaRunner.inpaint).not.toHaveBeenCalled();
  });
});
