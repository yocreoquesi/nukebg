import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PipelineAbortError, RmbgError, LamaError, DecodeError } from 'nukebg-core';
import type { ImageDataLike, PipelineOptions, PipelineResult, StageEvent } from 'nukebg-core';
import type {
  PipelineWorkerInput,
  PipelineWorkerMessage,
  SerializablePipelineResult,
} from './pipeline.worker.js';

/**
 * Runs the whole pipeline on a worker thread so the main thread can answer
 * SIGINT while CV is grinding.
 *
 * See issue #329: `patchMatchInpaint` blocks for ~2.3 s at 720p and ~14.4 s on
 * a 6 MP image, synchronously. On the main thread that window cannot be
 * interrupted at all — the SIGINT handler never gets to run. Cancelling here
 * is `worker.terminate()`, which is immediate rather than cooperative.
 */

/** Rebuild the right error class from what survived the thread boundary. */
function reviveError(msg: Extract<PipelineWorkerMessage, { kind: 'error' }>): Error {
  const opts = msg.code !== undefined ? { code: msg.code } : {};
  switch (msg.name) {
    case 'AbortError':
      return new PipelineAbortError(msg.message);
    case 'RmbgError':
      return new RmbgError(msg.message, opts);
    case 'LamaError':
      return new LamaError(msg.message, opts);
    case 'DecodeError':
      return new DecodeError(msg.message, opts);
    default: {
      const e = new Error(msg.message);
      e.name = msg.name;
      return e;
    }
  }
}

/**
 * Locate the built worker.
 *
 * `import.meta.url` is this module, so the sibling lookup lands on
 * `dist/pipeline.worker.js` in the tsup bundle. There is deliberately no
 * fallback to the TypeScript source: a silent fallback is how a broken build
 * ships green, and Node cannot run our `.ts` reliably anyway. If the file is
 * missing the CLI says so plainly.
 */
function resolveWorkerPath(): string {
  const url = new URL('./pipeline.worker.js', import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) {
    throw new Error(
      `Pipeline worker not found at ${path}. The CLI must be built (\`npm run build -w nukebg-cli\`) ` +
        `before it can run — tsup emits the worker as a separate entry alongside cli.js.`,
    );
  }
  return path;
}

export interface WorkerPipelineRunnerOptions {
  readonly cacheDir?: string;
  readonly noWatermark?: boolean;
  /** Test seam: override how the worker is created. */
  readonly spawn?: (path: string, input: PipelineWorkerInput) => Worker;
  /** Test seam: override where the worker lives. */
  readonly workerPath?: string;
}

export class WorkerPipelineRunner {
  private readonly opts: WorkerPipelineRunnerOptions;
  private active: Worker | null = null;

  constructor(opts: WorkerPipelineRunnerOptions = {}) {
    this.opts = opts;
  }

  async run(input: ImageDataLike, options: PipelineOptions = {}): Promise<PipelineResult> {
    const { signal, onStage, ...transferable } = options;

    if (signal?.aborted) throw new PipelineAbortError('aborted before the worker started');

    const workerInput: PipelineWorkerInput = {
      pixels: input.data,
      width: input.width,
      height: input.height,
      options: transferable,
      noWatermark: this.opts.noWatermark ?? false,
      ...(this.opts.cacheDir !== undefined ? { cacheDir: this.opts.cacheDir } : {}),
    };

    const path = this.opts.workerPath ?? resolveWorkerPath();
    const worker = this.opts.spawn
      ? this.opts.spawn(path, workerInput)
      : new Worker(path, { workerData: workerInput });
    this.active = worker;

    try {
      return await new Promise<PipelineResult>((resolve, reject) => {
        const onAbort = (): void => {
          // Immediate, not cooperative — this is the whole point of #329.
          void worker.terminate();
          reject(new PipelineAbortError('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        worker.on('message', (msg: PipelineWorkerMessage) => {
          if (msg.kind === 'stage') {
            onStage?.(msg.event as StageEvent);
            return;
          }
          signal?.removeEventListener('abort', onAbort);
          if (msg.kind === 'error') reject(reviveError(msg));
          else resolve(hydrate(msg.result));
        });

        worker.on('error', (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        });

        worker.on('exit', (code) => {
          signal?.removeEventListener('abort', onAbort);
          // A clean exit after a result already resolved is a no-op; this only
          // fires first when the worker died without reporting anything.
          if (code !== 0) {
            reject(new Error(`Pipeline worker exited with code ${code}`));
          }
        });
      });
    } finally {
      this.active = null;
      await worker.terminate().catch(() => undefined);
    }
  }

  async preload(): Promise<void> {
    // No-op: the worker preloads inside its own thread before running. Doing
    // it here would mean loading the model twice, in two threads.
  }

  async dispose(): Promise<void> {
    if (this.active) {
      await this.active.terminate().catch(() => undefined);
      this.active = null;
    }
  }
}

function hydrate(r: SerializablePipelineResult): PipelineResult {
  return {
    ...r,
    output: { data: r.output.data, width: r.output.width, height: r.output.height },
  } as PipelineResult;
}
