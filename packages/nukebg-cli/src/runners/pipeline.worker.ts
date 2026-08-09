/**
 * Pipeline worker thread.
 *
 * Everything expensive runs here — decode-side pixels in, finished
 * `PipelineResult` out — so the main thread stays free to answer SIGINT.
 *
 * This mirrors what the browser already does. `patchMatchInpaint` costs
 * ~2.3 s at 720p, ~4.8 s at 1080p and ~14.4 s on a 6 MP image (measured for
 * issue #329), and it runs synchronously. On the main thread that window is
 * simply uninterruptible: the SIGINT handler cannot run because the event
 * loop is blocked, so no amount of AbortSignal plumbing helps. In the browser
 * the same function already runs inside a Web Worker (`inpaint.worker.ts`),
 * which is why the browser never had this problem.
 *
 * Cancellation here is `worker.terminate()` — immediate, not cooperative.
 *
 * The ONNX runners are constructed inside the worker rather than on the main
 * thread. Splitting them would mean shuttling masks back and forth across the
 * boundary mid-pipeline; keeping the whole run on one side costs nothing
 * extra, because the worker is spawned per run anyway.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { ImageDataLike, PipelineOptions, PipelineResult, StageEvent } from 'nukebg-core';
import { OnnxNodeRmbgRunner } from './onnx-node-rmbg.js';
import { OnnxNodeLamaRunner } from './onnx-node-lama.js';
import { NodePipelineRunner } from './node-pipeline-runner.js';

/** What the main thread sends when it spawns us. */
export interface PipelineWorkerInput {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** `PipelineOptions` minus the things that cannot cross a thread boundary. */
  readonly options: Omit<PipelineOptions, 'signal' | 'onStage'>;
  readonly cacheDir?: string;
  /** Omit the LaMa runner entirely, mirroring ProcessCommand's own policy. */
  readonly noWatermark: boolean;
}

/** What we send back. Stage events stream; the result or error arrives once. */
export type PipelineWorkerMessage =
  | { readonly kind: 'stage'; readonly event: StageEvent }
  | { readonly kind: 'result'; readonly result: SerializablePipelineResult }
  | { readonly kind: 'error'; readonly name: string; readonly message: string; readonly code?: string };

/**
 * `PipelineResult` as it survives structured clone.
 *
 * `runPipeline` freezes its result and the typed arrays clone fine, but the
 * object is rebuilt on the other side, so this documents exactly what crosses.
 */
export interface SerializablePipelineResult {
  readonly output: { data: Uint8ClampedArray; width: number; height: number };
  readonly resolvedMode: PipelineResult['resolvedMode'];
  readonly durationMs: number;
  readonly stageTimings: PipelineResult['stageTimings'];
  readonly watermarkRemoved: boolean;
  readonly watermarkMask: Uint8Array | null;
  readonly workingPixels: Uint8ClampedArray;
  readonly workingAlpha: Uint8Array;
  readonly workingWidth: number;
  readonly workingHeight: number;
  readonly nukedPct: number;
  readonly contentType: PipelineResult['contentType'];
}

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error('pipeline.worker must be run as a worker thread');

  const input = workerData as PipelineWorkerInput;
  const cacheOpts = input.cacheDir !== undefined ? { cacheDir: input.cacheDir } : {};

  const rmbgRunner = new OnnxNodeRmbgRunner(cacheOpts);
  const lamaRunner = input.noWatermark ? undefined : new OnnxNodeLamaRunner(cacheOpts);
  const runner = new NodePipelineRunner(
    lamaRunner ? { rmbgRunner, lamaRunner } : { rmbgRunner },
  );

  try {
    await runner.preload();

    const image: ImageDataLike = {
      data: input.pixels,
      width: input.width,
      height: input.height,
    };

    const result = await runner.run(image, {
      ...input.options,
      onStage: (event: StageEvent) => {
        port.postMessage({ kind: 'stage', event } satisfies PipelineWorkerMessage);
      },
    });

    const payload: SerializablePipelineResult = {
      output: {
        data: result.output.data,
        width: result.output.width,
        height: result.output.height,
      },
      resolvedMode: result.resolvedMode,
      durationMs: result.durationMs,
      stageTimings: result.stageTimings,
      watermarkRemoved: result.watermarkRemoved,
      watermarkMask: result.watermarkMask,
      workingPixels: result.workingPixels,
      workingAlpha: result.workingAlpha,
      workingWidth: result.workingWidth,
      workingHeight: result.workingHeight,
      nukedPct: result.nukedPct,
      contentType: result.contentType,
    };

    port.postMessage({ kind: 'result', result: payload } satisfies PipelineWorkerMessage);
  } catch (err: unknown) {
    // Error instances do not survive structured clone with their prototype, so
    // send the discriminating fields and let the main thread rebuild the right
    // class — the exit-code mapping depends on both the class and the `code`.
    const e = err as { name?: string; message?: string; code?: unknown };
    port.postMessage({
      kind: 'error',
      name: typeof e?.name === 'string' ? e.name : 'Error',
      message: typeof e?.message === 'string' ? e.message : String(err),
      ...(typeof e?.code === 'string' ? { code: e.code } : {}),
    } satisfies PipelineWorkerMessage);
  } finally {
    await runner.dispose().catch(() => undefined);
  }
}

void main();
