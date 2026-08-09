import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { ImageCodec } from 'nukebg-core';
import { DecodeError, RmbgError } from 'nukebg-core';
import type { LamaRunner, PipelineResult, RmbgRunner } from 'nukebg-core';
import { ProcessCommand } from '../../src/commands/process.js';
import { ExitCode } from '../../src/util/exit-codes.js';

// ---------------------------------------------------------------------------
// `ProcessCommand` (REQ-CLI-INVOCATION-1 through 5, design §D.2 sequence).
// Filesystem, codec, and pipeline runners are all injected — no real disk
// I/O, sharp decode, or model download in these tests.
//
// `ProcessCommand.execute()` catches its own errors and RETURNS the mapped
// exit code (via `exitCodeFor`) rather than throwing — this lets the whole
// command be tested standalone, without `cli.ts`/commander in the loop
// (`cli.ts` just forwards to `new ProcessCommand().execute(opts)`, see
// tests/cli.test.ts for the commander-wiring-specific tests).
//
// DEVIATION from tasks.md's literal text: "Missing input file -> exits
// USER_ERROR (64)" is tested here as `ExitCode.NO_INPUT` (66) instead,
// per REQ-CLI-INVOCATION-2's explicit scenario ("the process exits 66
// (EX_NOINPUT)") and REQ-CLI-INVOCATION-6's exit code table, both of which
// require a code distinct from bad-flags (64) and decode-failure (65). See
// exit-codes.ts's doc comment and the Phase 16 apply-progress notes.
// ---------------------------------------------------------------------------

function makeStubCodec(overrides?: Partial<ImageCodec>): ImageCodec {
  return {
    decode: vi.fn(async () => ({
      image: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      originalWidth: 2,
      originalHeight: 2,
      wasDownsampled: false,
    })),
    encode: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    ...overrides,
  };
}

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

function makeFakeResult(overrides?: Partial<PipelineResult>): PipelineResult {
  return {
    output: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
    resolvedMode: 'photo',
    durationMs: 100,
    stageTimings: { watermark: 10, rmbg: 1234, inpaint: 0, finalize: 5 },
    watermarkRemoved: false,
    watermarkMask: null,
    workingPixels: new Uint8ClampedArray(16),
    workingAlpha: new Uint8Array(4),
    workingWidth: 2,
    workingHeight: 2,
    nukedPct: 10,
    contentType: 'PHOTO',
    ...overrides,
  };
}

function makeDeps(opts?: {
  codec?: ImageCodec;
  readFileImpl?: (path: string) => Promise<Buffer>;
  runResult?: PipelineResult;
  runError?: unknown;
  preloadError?: unknown;
  createLamaRunner?: (opts: { cacheDir?: string }) => LamaRunner;
}) {
  const writeFileImpl = vi.fn(async () => undefined);
  const createLamaRunner = opts?.createLamaRunner ?? vi.fn(() => makeStubLama());
  const stubRunner = {
    preload: vi.fn(async () => {
      if (opts?.preloadError) throw opts.preloadError;
    }),
    run: vi.fn(async () => {
      if (opts?.runError) throw opts.runError;
      return opts?.runResult ?? makeFakeResult();
    }),
    dispose: vi.fn(async () => undefined),
  };

  return {
    deps: {
      codec: opts?.codec ?? makeStubCodec(),
      readFileImpl: opts?.readFileImpl ?? vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      writeFileImpl,
      createRmbgRunner: vi.fn(() => makeStubRmbg()),
      createLamaRunner,
      createPipelineRunner: vi.fn(() => stubRunner),
      assertAccepted: vi.fn(async () => undefined),
      stderrWrite: vi.fn(),
    },
    writeFileImpl,
    createLamaRunner,
    stubRunner,
  };
}

describe('ProcessCommand', () => {
  it('exits NO_INPUT (66) with a stderr message when the input file does not exist', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const { deps } = makeDeps({ readFileImpl });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'missing.png' });

    expect(exitCode).toBe(ExitCode.NO_INPUT);
    expect(deps.stderrWrite).toHaveBeenCalled();
  });

  it('exits INPUT_DECODE_FAILED (65) when the codec cannot decode the bytes', async () => {
    const codec = makeStubCodec({
      decode: vi.fn(async () => {
        throw new DecodeError('not an image');
      }),
    });
    const { deps } = makeDeps({ codec });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'document.txt' });

    expect(exitCode).toBe(ExitCode.INPUT_DECODE_FAILED);
  });

  it('writes to <stem>.nukebg.png in the same directory when -o is omitted', async () => {
    const { deps, writeFileImpl } = makeDeps();
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: join('photos', 'cat.jpg') });

    expect(exitCode).toBe(ExitCode.OK);
    expect(writeFileImpl).toHaveBeenCalledWith(
      join('photos', 'cat.nukebg.png'),
      expect.any(Uint8Array),
    );
  });

  it('writes to the explicit -o path when provided', async () => {
    const { deps, writeFileImpl } = makeDeps();
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'cat.jpg', output: 'result.png' });

    expect(exitCode).toBe(ExitCode.OK);
    expect(writeFileImpl).toHaveBeenCalledWith('result.png', expect.any(Uint8Array));
  });

  it('encodes as webp and writes RIFF/WEBP-header bytes when --format webp is passed', async () => {
    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const codec = makeStubCodec({ encode: vi.fn(async () => webpBytes) });
    const { deps, writeFileImpl } = makeDeps({ codec });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'cat.jpg', format: 'webp' });

    expect(exitCode).toBe(ExitCode.OK);
    expect(codec.encode).toHaveBeenCalledWith(expect.anything(), 'webp');
    expect(writeFileImpl).toHaveBeenCalledWith('cat.nukebg.webp', webpBytes);
    expect(webpBytes[0]).toBe(0x52); // R
    expect(webpBytes[1]).toBe(0x49); // I
    expect(webpBytes[2]).toBe(0x46); // F
    expect(webpBytes[3]).toBe(0x46); // F
    expect(webpBytes[8]).toBe(0x57); // W
    expect(webpBytes[9]).toBe(0x45); // E
    expect(webpBytes[10]).toBe(0x42); // B
    expect(webpBytes[11]).toBe(0x50); // P
  });

  it('never constructs a LamaRunner when --no-watermark is passed', async () => {
    const createLamaRunner = vi.fn(() => makeStubLama());
    const { deps } = makeDeps({ createLamaRunner });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'photo.png', noWatermark: true });

    expect(exitCode).toBe(ExitCode.OK);
    expect(createLamaRunner).not.toHaveBeenCalled();
  });

  it('forwards --mode and --precision to the pipeline runner exactly as supplied', async () => {
    const { deps, stubRunner } = makeDeps();
    const cmd = new ProcessCommand(deps);

    await cmd.execute({ input: 'logo.png', mode: 'icon', precision: 'high' });

    expect(stubRunner.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'icon', precision: 'high' }),
    );
  });

  it('forwards skipAutoCrop: true to the pipeline runner when --no-auto-crop is passed (W1)', async () => {
    const { deps, stubRunner } = makeDeps();
    const cmd = new ProcessCommand(deps);

    await cmd.execute({ input: 'photo.png', noAutoCrop: true });

    expect(stubRunner.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipAutoCrop: true }),
    );
  });

  it('emits nothing on stderr when --quiet is passed and processing succeeds', async () => {
    const { deps } = makeDeps();
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'input.png', quiet: true });

    expect(exitCode).toBe(ExitCode.OK);
    expect(deps.stderrWrite).not.toHaveBeenCalled();
  });

  it('emits at least one timing line on stderr when --verbose is passed', async () => {
    const { deps } = makeDeps({ runResult: makeFakeResult({ stageTimings: { rmbg: 1234 } }) });
    const cmd = new ProcessCommand(deps);

    await cmd.execute({ input: 'input.png', verbose: true });

    const calls = (deps.stderrWrite as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls.some((line) => /rmbg:\s*1234ms/.test(line))).toBe(true);
  });

  it('exits MODEL_DOWNLOAD_FAILED (74) when the model preload fails', async () => {
    const { deps } = makeDeps({
      preloadError: new RmbgError('network error after retries', {
        code: 'RMBG_DOWNLOAD_FAILED',
      }),
    });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'input.png' });

    expect(exitCode).toBe(ExitCode.MODEL_DOWNLOAD_FAILED);
  });

  it('exits PIPELINE_FAILED (70) when the pipeline run throws an unrecognised error', async () => {
    const { deps } = makeDeps({ runError: new Error('unexpected CV failure') });
    const cmd = new ProcessCommand(deps);

    const exitCode = await cmd.execute({ input: 'input.png' });

    expect(exitCode).toBe(ExitCode.PIPELINE_FAILED);
  });
});
