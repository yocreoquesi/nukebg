import { describe, it, expect, vi } from 'vitest';
import type { ProcessCommandOptions } from '../src/commands/process.js';
import type { LicenseCommandOptions } from '../src/commands/license.js';
import { runCli } from '../src/cli.js';
import { ExitCode } from '../src/util/exit-codes.js';

// ---------------------------------------------------------------------------
// `runCli` — commander wiring (design §H.1, §H.6; REQ-CLI-INVOCATION-1
// through 6). `runCli(argv, deps)` RETURNS the resolved exit code rather
// than calling `process.exit()` directly — mirrors `ProcessCommand.execute`'s
// testable pattern so these tests never risk killing the vitest worker.
// `runProcessCommand`/`runLicense` are injected so this suite tests ONLY the
// commander wiring (option parsing/forwarding, exit-code mapping for
// parse-time failures), not `ProcessCommand`'s own behavior (already
// covered in tests/commands/process.test.ts).
// ---------------------------------------------------------------------------

function makeDeps(overrides?: {
  runProcessCommand?: (opts: ProcessCommandOptions) => Promise<number>;
  runLicense?: (opts: LicenseCommandOptions) => Promise<number>;
}) {
  const runProcessCommand = overrides?.runProcessCommand ?? vi.fn(async () => ExitCode.OK);
  const runLicense = overrides?.runLicense ?? vi.fn(async () => ExitCode.OK);
  const stdoutWrite = vi.fn();
  const stderrWrite = vi.fn();
  return {
    deps: {
      runProcessCommand,
      runLicense,
      stdoutWrite,
      stderrWrite,
      cliVersion: '9.9.9',
    },
    runProcessCommand,
    runLicense,
    stdoutWrite,
    stderrWrite,
  };
}

describe('runCli', () => {
  it('parses <input> and calls runProcessCommand with the resolved options, returning its exit code', async () => {
    const { deps, runProcessCommand } = makeDeps({
      runProcessCommand: vi.fn(async () => ExitCode.OK),
    });

    const exitCode = await runCli(['input.png'], deps);

    expect(exitCode).toBe(ExitCode.OK);
    expect(runProcessCommand).toHaveBeenCalledTimes(1);
    expect(runProcessCommand).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'input.png', cliVersion: '9.9.9' }),
    );
  });

  it('forwards all §H.6 process options to runProcessCommand', async () => {
    const { deps, runProcessCommand } = makeDeps();

    await runCli(
      [
        'cat.jpg',
        '-o',
        'result.png',
        '-f',
        'webp',
        '--mode',
        'icon',
        '--precision',
        'high',
        '--no-watermark',
        '--no-auto-crop',
        '--cache-dir',
        '/tmp/cache',
        '--accept-non-commercial',
        '-q',
        '-v',
      ],
      deps,
    );

    expect(runProcessCommand).toHaveBeenCalledWith({
      input: 'cat.jpg',
      output: 'result.png',
      format: 'webp',
      mode: 'icon',
      precision: 'high',
      noWatermark: true,
      noAutoCrop: true,
      cacheDir: '/tmp/cache',
      acceptNonCommercial: true,
      quiet: true,
      verbose: true,
      cliVersion: '9.9.9',
    });
  });

  it('dispatches `license` to runLicense and returns its exit code', async () => {
    const { deps, runLicense, runProcessCommand } = makeDeps({
      runLicense: vi.fn(async () => ExitCode.OK),
    });

    const exitCode = await runCli(['license'], deps);

    expect(exitCode).toBe(ExitCode.OK);
    expect(runLicense).toHaveBeenCalledTimes(1);
    expect(runProcessCommand).not.toHaveBeenCalled();
  });

  it('forwards --revoke to runLicense for `license --revoke`', async () => {
    const { deps, runLicense } = makeDeps();

    await runCli(['license', '--revoke'], deps);

    expect(runLicense).toHaveBeenCalledWith(
      expect.objectContaining({ revoke: true, cliVersion: '9.9.9' }),
    );
  });

  it('exits USER_ERROR (64) with a usage message on stderr for an unrecognized flag (REQ-CLI-INVOCATION-1)', async () => {
    const { deps, stderrWrite, runProcessCommand } = makeDeps();

    const exitCode = await runCli(['test.png', '--not-a-flag'], deps);

    expect(exitCode).toBe(ExitCode.USER_ERROR);
    expect(stderrWrite).toHaveBeenCalled();
    expect(runProcessCommand).not.toHaveBeenCalled();
  });

  it('exits USER_ERROR (64) when the required <input> positional is missing', async () => {
    const { deps } = makeDeps();

    const exitCode = await runCli([], deps);

    expect(exitCode).toBe(ExitCode.USER_ERROR);
  });

  it('exits OK (0) and prints usage for --help, without running the process command', async () => {
    const { deps, stdoutWrite, runProcessCommand } = makeDeps();

    const exitCode = await runCli(['--help'], deps);

    expect(exitCode).toBe(ExitCode.OK);
    expect(stdoutWrite).toHaveBeenCalled();
    expect(runProcessCommand).not.toHaveBeenCalled();
  });

  it('exits OK (0) and prints the version for --version, without running the process command', async () => {
    const { deps, stdoutWrite, runProcessCommand } = makeDeps();

    const exitCode = await runCli(['--version'], deps);

    expect(exitCode).toBe(ExitCode.OK);
    const printed = stdoutWrite.mock.calls.map((c) => c[0] as string).join('');
    expect(printed).toContain('9.9.9');
    expect(runProcessCommand).not.toHaveBeenCalled();
  });
});
