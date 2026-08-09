import { describe, it, expect, vi } from 'vitest';
import type { LamaRunner, RmbgRunner } from 'nukebg-core';
import { NodePipelineRunner } from '../../src/runners/node-pipeline-runner.js';

// LaMa must stay lazy, matching the browser orchestrator's policy ("Inpaint +
// LaMa stay lazy so we don't pay for a worker the router may not pick"). The
// watermark router decides per image whether LaMa is needed at all, and most
// images never reach it.
//
// Regression this guards (code review, Aug 9 2026): preload() awaited both
// runners, so every `nukebg image.png` downloaded the ~90MB LaMa ONNX before
// any work started — and a failed LaMa fetch aborted runs on images that
// needed no inpainting, surfacing as exit 74.

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

describe('NodePipelineRunner.preload — LaMa stays lazy', () => {
  it('loads RMBG but not LaMa', async () => {
    const rmbgRunner = makeStubRmbg();
    const lamaRunner = makeStubLama();

    await new NodePipelineRunner({ rmbgRunner, lamaRunner }).preload();

    expect(rmbgRunner.load).toHaveBeenCalledTimes(1);
    expect(lamaRunner.load).not.toHaveBeenCalled();
  });

  it('does not fail when LaMa would fail to load', async () => {
    const rmbgRunner = makeStubRmbg();
    const lamaRunner: LamaRunner = {
      ...makeStubLama(),
      load: vi.fn(async () => {
        throw new Error('LaMa model download 404');
      }),
    };

    // An image that never needs inpainting must not be blocked by LaMa.
    await expect(
      new NodePipelineRunner({ rmbgRunner, lamaRunner }).preload(),
    ).resolves.toBeUndefined();
  });
});
