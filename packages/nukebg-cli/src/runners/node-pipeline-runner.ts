import { runPipeline } from 'nukebg-core';
import type {
  ImageDataLike,
  LamaRunner,
  PipelineOptions,
  PipelineResult,
  PipelineRunner,
  RmbgRunner,
  RunnerBundle,
} from 'nukebg-core';

// ---------------------------------------------------------------------------
// NodePipelineRunner
// ---------------------------------------------------------------------------
//
// Inline `PipelineRunner` implementation for the CLI (design §C.2). Unlike
// the browser's `WorkerPipelineRunner` (which fans out to Web Workers), this
// runner calls core `runPipeline` directly in-process — there is no worker
// boundary to cross in Node.
//
// `PipelineRunner.run()` operates on already-decoded `ImageDataLike`;
// decode/encode belongs one layer up in the CLI's `process` command (design
// §D.2, Phase 16), so no `ImageCodec` is held here.

export interface NodePipelineRunnerOptions {
  readonly rmbgRunner: RmbgRunner;
  /** Optional — when omitted (or when `run()` is called with `skipWatermark: true`), the LaMa branch falls back to PatchMatch inside core. */
  readonly lamaRunner?: LamaRunner;
}

export class NodePipelineRunner implements PipelineRunner {
  private readonly rmbgRunner: RmbgRunner;
  private readonly lamaRunner: LamaRunner | undefined;

  constructor(opts: NodePipelineRunnerOptions) {
    this.rmbgRunner = opts.rmbgRunner;
    this.lamaRunner = opts.lamaRunner;
  }

  async run(input: ImageDataLike, options: PipelineOptions = {}): Promise<PipelineResult> {
    const skipWatermark = options.skipWatermark ?? false;
    // `RunnerBundle.lama` is a real optional property (`lama?: LamaRunner`)
    // under `exactOptionalPropertyTypes` — the key must be OMITTED, not set
    // to `undefined`, to skip it. REQ-CORE-RUNNERS-2: no LamaRunner method
    // should be invoked when `skipWatermark: true`.
    const bundle: RunnerBundle =
      this.lamaRunner && !skipWatermark
        ? { rmbg: this.rmbgRunner, lama: this.lamaRunner }
        : { rmbg: this.rmbgRunner };
    return runPipeline(input, bundle, options);
  }

  async preload(): Promise<void> {
    // RMBG only. LaMa stays lazy — the same policy the browser orchestrator
    // had ("Inpaint + LaMa stay lazy so we don't pay for a worker the router
    // may not pick"): the watermark router decides per image whether LaMa is
    // needed at all, and most images never reach it. Preloading it eagerly
    // made every run download ~90MB before any work started, and turned a
    // failed LaMa fetch into a hard failure for images that needed no
    // inpainting. `runPipeline` loads it on first use via the runner itself.
    await this.rmbgRunner.load?.();
  }

  async dispose(): Promise<void> {
    await Promise.all([
      this.rmbgRunner.dispose(),
      this.lamaRunner ? this.lamaRunner.dispose() : Promise.resolve(),
    ]);
  }
}
