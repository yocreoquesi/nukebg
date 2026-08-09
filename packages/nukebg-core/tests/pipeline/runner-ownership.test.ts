import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import type { RunnerBundle } from '../../src/pipeline/run-pipeline.js';
import { createImageDataLike } from '../../src/types/image-data-like.js';
import type { ImageDataLike } from '../../src/types/image-data-like.js';
import type { LamaRunner } from '../../src/runners/lama-runner.js';
import type { RmbgRunner } from '../../src/runners/rmbg-runner.js';

// Runner lifetime belongs to whoever constructed the runner, never to
// runPipeline. The bundle is injected, and hosts reuse one bundle across
// images (batch mode, a server, the CLI).
//
// Regression this guards (code review, Aug 9 2026): runPipeline disposed
// `runners.lama` in a `finally` after a single inpaint. A host reusing the
// bundle paid a ~90MB model reload on every image after the first, and a
// Worker-backed LamaRunner whose dispose() terminates the worker failed
// outright on the second call — surfacing as LamaError -> exit 74.
//
// Every test here asserts `inpaintCount` as well as `disposeCount`: without
// that the LaMa branch may never be entered and the whole suite passes
// vacuously, which is exactly how this defect survived to begin with.

/**
 * An image that reliably drives the watermark path to LaMa.
 *
 * The background is a vertical gradient, so every single ROW is one quantized
 * colour — that keeps `watermarkDetectDalle`'s reference row below the colour
 * threshold — while variance across a 2D bbox stays high enough for
 * `shouldUseLama` to prefer LaMa over PatchMatch. The bottom-right bar
 * supplies the many distinct colours and wide channel spread the detector
 * requires.
 */
function watermarkedImage(w = 240, h = 180): ImageDataLike {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = Math.floor((y / h) * 255);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = v;
      d[i + 1] = 255 - v;
      d[i + 2] = (v * 2) % 255;
      d[i + 3] = 255;
    }
  }
  const scanW = Math.min(200, Math.floor(w / 3));
  for (let y = h - 10; y < h; y++) {
    for (let x = w - scanW; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (x - (w - scanW)) / scanW;
      d[i] = Math.floor(255 * Math.abs(Math.sin(t * 9)));
      d[i + 1] = Math.floor(255 * Math.abs(Math.sin(t * 9 + 2)));
      d[i + 2] = Math.floor(255 * Math.abs(Math.sin(t * 9 + 4)));
      d[i + 3] = 255;
    }
  }
  return createImageDataLike(d, w, h);
}

function makeRmbgStub(): RmbgRunner {
  return {
    async segment(input) {
      return new Uint8Array(input.width * input.height).fill(200);
    },
    async dispose() {},
  };
}

function makeCountingLama(): LamaRunner & { disposeCount: number; inpaintCount: number } {
  let disposeCount = 0;
  let inpaintCount = 0;
  return {
    get disposeCount() {
      return disposeCount;
    },
    get inpaintCount() {
      return inpaintCount;
    },
    async inpaint(input) {
      inpaintCount++;
      return new Uint8ClampedArray(input.width * input.height * 4).fill(255);
    },
    async dispose() {
      disposeCount++;
    },
  };
}

describe('runPipeline does not dispose caller-injected runners', () => {
  it('leaves the LaMa runner alive after using it', async () => {
    const lama = makeCountingLama();
    const runners: RunnerBundle = { rmbg: makeRmbgStub(), lama };

    await runPipeline(watermarkedImage(), runners, { mode: 'photo', skipWatermark: false });

    // Guard against a vacuous pass: the branch under test must have run.
    expect(lama.inpaintCount).toBeGreaterThan(0);
    expect(lama.disposeCount).toBe(0);
  });

  it('supports reusing one bundle across successive runs', async () => {
    const lama = makeCountingLama();
    const runners: RunnerBundle = { rmbg: makeRmbgStub(), lama };

    // The second run is the one that used to break: on a Worker-backed runner
    // the terminated worker makes inpaint() reject outright.
    await runPipeline(watermarkedImage(), runners, { mode: 'photo', skipWatermark: false });
    await runPipeline(watermarkedImage(), runners, { mode: 'photo', skipWatermark: false });

    expect(lama.inpaintCount).toBe(2);
    expect(lama.disposeCount).toBe(0);
  });
});
