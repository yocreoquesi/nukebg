import { readFile as nodeReadFile, writeFile as nodeWriteFile } from 'node:fs/promises';
import { join, parse as parsePath } from 'node:path';
import type {
  EncodeFormat,
  ImageCodec,
  LamaRunner,
  PipelineMode,
  PipelineOptions,
  PipelinePrecision,
  PipelineRunner,
  RmbgRunner,
} from 'nukebg-core';
import {
  autoCropToSubject,
  finalizePipelineResult,
  PipelineAbortError,
} from 'nukebg-core';
import { SharpImageCodec } from '../codecs/sharp-codec.js';
import { OnnxNodeLamaRunner } from '../runners/onnx-node-lama.js';
import { OnnxNodeRmbgRunner } from '../runners/onnx-node-rmbg.js';
import { NodePipelineRunner } from '../runners/node-pipeline-runner.js';
import { assertAccepted as defaultAssertAccepted } from '../license/gate.js';
import type { GateOptions } from '../license/gate.js';
import { ExitCode } from '../util/exit-codes.js';
import { exitCodeFor, IoError, NoInputError } from '../util/errors.js';

// ---------------------------------------------------------------------------
// `ProcessCommand` — the `nukebg <input>` command handler (design §D.2
// sequence, REQ-CLI-INVOCATION-1 through 5):
//
//   license gate -> read input -> decode -> construct runners (skip LaMa
//   entirely for --no-watermark) -> preload -> runPipeline (via
//   NodePipelineRunner) -> encode -> write output
//
// `execute()` catches ALL errors internally and returns the mapped exit
// code (`exitCodeFor`, util/errors.ts) rather than throwing. This keeps the
// command fully testable without `cli.ts` / `commander` in the loop — see
// apply-progress: commander could not be installed in this environment, so
// `cli.ts`'s commander wiring (tasks 16.7-16.9) is deferred, but this
// command's own behavior (tasks 16.3-16.4) is not blocked by that.
// ---------------------------------------------------------------------------

export interface ProcessCommandOptions {
  readonly input: string;
  readonly output?: string;
  readonly format?: EncodeFormat;
  readonly mode?: PipelineMode;
  readonly precision?: PipelinePrecision;
  readonly noWatermark?: boolean;
  readonly noAutoCrop?: boolean;
  readonly cacheDir?: string;
  readonly acceptNonCommercial?: boolean;
  readonly quiet?: boolean;
  readonly verbose?: boolean;
  readonly cliVersion?: string;
  /**
   * Cancellation. Honoured at every asynchronous boundary — model download,
   * RMBG segmentation, LaMa inpaint and each stage checkpoint in
   * `runPipeline`. Synchronous CV (PatchMatch, sparkle detection) cannot be
   * interrupted mid-loop; see issue #329.
   */
  readonly signal?: AbortSignal;
}

export interface ProcessCommandDeps {
  readonly readFileImpl?: (path: string) => Promise<Buffer>;
  readonly writeFileImpl?: (path: string, data: Uint8Array) => Promise<void>;
  readonly codec?: ImageCodec;
  readonly createRmbgRunner?: (opts: { cacheDir?: string }) => RmbgRunner;
  readonly createLamaRunner?: (opts: { cacheDir?: string }) => LamaRunner;
  readonly createPipelineRunner?: (bundle: {
    rmbgRunner: RmbgRunner;
    lamaRunner?: LamaRunner;
  }) => PipelineRunner;
  readonly assertAccepted?: (opts: GateOptions) => Promise<void>;
  readonly stderrWrite?: (text: string) => void;
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/** REQ-CLI-INVOCATION-3: explicit --format wins; else infer from -o's extension; else png. */
function resolveFormat(explicit: EncodeFormat | undefined, outputPath: string | undefined): EncodeFormat {
  if (explicit) return explicit;
  if (outputPath && outputPath.toLowerCase().endsWith('.webp')) return 'webp';
  return 'png';
}

/** REQ-CLI-INVOCATION-3: default output is `<stem>.nukebg.<format>` next to the input. */
function resolveOutputPath(input: string, output: string | undefined, format: EncodeFormat): string {
  if (output) return output;
  const { dir, name } = parsePath(input);
  return join(dir, `${name}.nukebg.${format}`);
}

interface ResolvedDeps {
  readonly readFileImpl: (path: string) => Promise<Buffer>;
  readonly writeFileImpl: (path: string, data: Uint8Array) => Promise<void>;
  readonly codec: ImageCodec;
  readonly createRmbgRunner: (opts: { cacheDir?: string }) => RmbgRunner;
  readonly createLamaRunner: (opts: { cacheDir?: string }) => LamaRunner;
  readonly createPipelineRunner: (bundle: {
    rmbgRunner: RmbgRunner;
    lamaRunner?: LamaRunner;
  }) => PipelineRunner;
  readonly assertAccepted: (opts: GateOptions) => Promise<void>;
  readonly stderrWrite: (text: string) => void;
}

function resolveDeps(deps: ProcessCommandDeps): ResolvedDeps {
  return {
    readFileImpl: deps.readFileImpl ?? ((p) => nodeReadFile(p)),
    writeFileImpl: deps.writeFileImpl ?? ((p, d) => nodeWriteFile(p, d)),
    codec: deps.codec ?? new SharpImageCodec(),
    createRmbgRunner: deps.createRmbgRunner ?? ((o) => new OnnxNodeRmbgRunner(o)),
    createLamaRunner: deps.createLamaRunner ?? ((o) => new OnnxNodeLamaRunner(o)),
    createPipelineRunner:
      deps.createPipelineRunner ??
      ((bundle) =>
        new NodePipelineRunner(
          bundle.lamaRunner
            ? { rmbgRunner: bundle.rmbgRunner, lamaRunner: bundle.lamaRunner }
            : { rmbgRunner: bundle.rmbgRunner },
        )),
    assertAccepted: deps.assertAccepted ?? defaultAssertAccepted,
    stderrWrite:
      deps.stderrWrite ??
      ((text: string) => {
        process.stderr.write(text);
      }),
  };
}

export class ProcessCommand {
  private readonly deps: ResolvedDeps;

  constructor(deps: ProcessCommandDeps = {}) {
    this.deps = resolveDeps(deps);
  }

  async execute(options: ProcessCommandOptions): Promise<number> {
    const log = (text: string): void => {
      if (!options.quiet) this.deps.stderrWrite(text);
    };

    try {
      await this.deps.assertAccepted({
        ...(options.acceptNonCommercial !== undefined
          ? { acceptFlag: options.acceptNonCommercial }
          : {}),
        ...(options.cliVersion !== undefined ? { cliVersion: options.cliVersion } : {}),
      });

      log(`Reading ${options.input}...\n`);
      let bytes: Buffer;
      try {
        bytes = await this.deps.readFileImpl(options.input);
      } catch (err) {
        if (isEnoent(err)) {
          throw new NoInputError(`Input file not found: ${options.input}`, { cause: err });
        }
        throw new IoError(`Failed to read input file: ${options.input}`, { cause: err });
      }

      const decoded = await this.deps.codec.decode(bytes);

      const format = resolveFormat(options.format, options.output);
      const outputPath = resolveOutputPath(options.input, options.output, format);

      const noWatermark = options.noWatermark ?? false;
      const rmbgRunner = this.deps.createRmbgRunner(
        options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {},
      );
      const lamaRunner = noWatermark
        ? undefined
        : this.deps.createLamaRunner(
            options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {},
          );
      const runner = this.deps.createPipelineRunner(
        lamaRunner ? { rmbgRunner, lamaRunner } : { rmbgRunner },
      );

      log('Loading models...\n');
      await runner.preload?.();

      log(`Running pipeline (mode=${options.mode ?? 'auto'}, precision=${options.precision ?? 'normal'})...\n`);
      const pipelineOptions: PipelineOptions = {
        skipWatermark: noWatermark,
        skipAutoCrop: options.noAutoCrop ?? false,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.precision !== undefined ? { precision: options.precision } : {}),
      };
      const result = await runner.run(decoded.image, pipelineOptions);

      if (options.verbose) {
        for (const [stage, ms] of Object.entries(result.stageTimings)) {
          this.deps.stderrWrite(`${stage}: ${ms}ms\n`);
        }
      }

      // `result.output` is the working-resolution composite, not the image a
      // user should receive. The browser host runs the same two-step export
      // chain (see nukebg-app batch-orchestrator): compose at original
      // resolution and clean up topology, then tighten to the subject bbox.
      // Skipping it here is what made CLI output diverge visibly from the web
      // app — soft-alpha halos left unsharpened, orphan blobs kept, interior
      // holes unfilled — and made `--no-auto-crop` an inert flag.
      const finalized = finalizePipelineResult(result, decoded.image);
      const exported = options.noAutoCrop === true ? finalized : autoCropToSubject(finalized);

      if (options.signal?.aborted) {
        throw new PipelineAbortError('aborted before encoding output');
      }

      log('Encoding output...\n');
      const encoded = await this.deps.codec.encode(exported, format);

      try {
        await this.deps.writeFileImpl(outputPath, encoded);
      } catch (err) {
        throw new IoError(`Failed to write output file: ${outputPath}`, { cause: err });
      }

      log(`Wrote ${outputPath}\n`);
      return ExitCode.OK;
    } catch (err) {
      const code = exitCodeFor(err);
      const message = err instanceof Error ? err.message : String(err);
      this.deps.stderrWrite(`Error: ${message}\n`);
      return code;
    }
  }
}
