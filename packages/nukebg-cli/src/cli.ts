#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander';
import { pathToFileURL } from 'node:url';
import type { EncodeFormat, PipelineMode, PipelinePrecision } from 'nukebg-core';
import { ProcessCommand } from './commands/process.js';
import type { ProcessCommandOptions } from './commands/process.js';
import { runLicenseCommand } from './commands/license.js';
import type { LicenseCommandOptions } from './commands/license.js';
import { ExitCode } from './util/exit-codes.js';
import { resolveVersion } from './util/version.js';

// ---------------------------------------------------------------------------
// `nukebg` CLI entrypoint (design §H.1, §H.6 final option set;
// REQ-CLI-INVOCATION-1 through 6). Two commands:
//
//   nukebg <input> [options]   — the ROOT command's own action (default)
//   nukebg license [--revoke]  — a `program.command('license')` subcommand
//
// `runCli(argv, deps)` RETURNS the resolved exit code rather than calling
// `process.exit()` itself — mirrors `ProcessCommand.execute`'s pattern so it
// is fully unit-testable (tests/cli.test.ts) without spawning a subprocess
// or risking killing the test worker. Only the real `main()` entrypoint
// below (guarded by the `isMainModule` check) calls `process.exit`.
//
// `program.exitOverride()` + `configureOutput()` prevent commander from
// calling `process.exit` / writing to the real streams directly — parse
// failures (unrecognized flags, missing required `<input>`, `--help`,
// `--version`) surface as a thrown `CommanderError` that this module maps
// to the sysexits-aligned codes REQ-CLI-INVOCATION-1/6 require:
//   - `--help` / `--version` (`err.exitCode === 0`)      -> ExitCode.OK (0)
//   - any other parse failure (unknown option, missing
//     required argument, invalid choice value, etc.)     -> ExitCode.USER_ERROR (64)
// (Commander's OWN default exit codes — e.g. 1 for unknown-option — are
// intentionally NOT used; sysexits 64 is what the spec requires.)
// ---------------------------------------------------------------------------

export interface RunCliDeps {
  readonly stdoutWrite?: (text: string) => void;
  readonly stderrWrite?: (text: string) => void;
  readonly cliVersion?: string;
  readonly runProcessCommand?: (opts: ProcessCommandOptions) => Promise<number>;
  readonly runLicense?: (opts: LicenseCommandOptions) => Promise<number>;
}

interface RawProcessOptions {
  output?: string;
  format?: EncodeFormat;
  mode?: PipelineMode;
  precision?: PipelinePrecision;
  watermark?: boolean;
  cacheDir?: string;
  acceptNonCommercial?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

interface RawLicenseOptions {
  revoke?: boolean;
}

function buildProcessOptions(
  input: string,
  raw: RawProcessOptions,
  cliVersion: string,
): ProcessCommandOptions {
  return {
    input,
    cliVersion,
    ...(raw.output !== undefined ? { output: raw.output } : {}),
    ...(raw.format !== undefined ? { format: raw.format } : {}),
    ...(raw.mode !== undefined ? { mode: raw.mode } : {}),
    ...(raw.precision !== undefined ? { precision: raw.precision } : {}),
    // commander's `--no-watermark` sets `watermark: false`; default (flag
    // absent) is `watermark: true`. `noWatermark` is the inverse.
    noWatermark: raw.watermark === false,
    ...(raw.cacheDir !== undefined ? { cacheDir: raw.cacheDir } : {}),
    ...(raw.acceptNonCommercial !== undefined
      ? { acceptNonCommercial: raw.acceptNonCommercial }
      : {}),
    quiet: Boolean(raw.quiet),
    verbose: Boolean(raw.verbose),
  };
}

export async function runCli(argv: string[], deps: RunCliDeps = {}): Promise<number> {
  const stdoutWrite =
    deps.stdoutWrite ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const stderrWrite =
    deps.stderrWrite ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const cliVersion = deps.cliVersion ?? resolveVersion();
  const runProcessCommand =
    deps.runProcessCommand ?? ((opts: ProcessCommandOptions) => new ProcessCommand().execute(opts));
  const runLicense = deps.runLicense ?? ((opts: LicenseCommandOptions) => runLicenseCommand(opts));

  let exitCode: number = ExitCode.OK;

  const program = new Command();
  program
    .name('nukebg')
    .description('Remove backgrounds from images using nukebg-core (Node-only CLI).')
    .version(cliVersion, '--version', 'print version and exit')
    .exitOverride()
    .configureOutput({ writeOut: stdoutWrite, writeErr: stderrWrite })
    .showHelpAfterError(false);

  program
    .argument('<input>', 'input image path')
    .option('-o, --output <path>', 'output file path (default: <stem>.nukebg.<format>)')
    .addOption(
      new Option('-f, --format <format>', 'output format').choices(['png', 'webp'] as const),
    )
    .addOption(
      new Option('--mode <mode>', 'pipeline content mode').choices([
        'photo',
        'signature',
        'icon',
        'auto',
      ] as const),
    )
    .addOption(
      new Option('--precision <precision>', 'pipeline precision').choices([
        'low',
        'normal',
        'high',
        'ultra',
      ] as const),
    )
    .option('--no-watermark', 'skip watermark detection + inpainting')
    .option('--cache-dir <path>', 'override model cache directory')
    .option('--accept-non-commercial', 'acknowledge RMBG-1.4 CC-BY-NC-4.0 (non-interactive)')
    .option('--json', 'emit line-delimited JSON events on stdout (deferred to v1.1)')
    .option('-q, --quiet', 'suppress non-error stderr output')
    .option('-v, --verbose', 'extra timings on stderr')
    .action(async (input: string, raw: RawProcessOptions) => {
      exitCode = await runProcessCommand(buildProcessOptions(input, raw, cliVersion));
    });

  program
    .command('license')
    .description('Manage RMBG-1.4 (CC-BY-NC-4.0) license acceptance')
    .option('--revoke', 'delete the acceptance marker')
    .action(async (raw: RawLicenseOptions) => {
      exitCode = await runLicense({ revoke: Boolean(raw.revoke), cliVersion, stdoutWrite });
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode === 0 ? ExitCode.OK : ExitCode.USER_ERROR;
    }
    throw err;
  }

  return exitCode;
}

// ---------------------------------------------------------------------------
// Real entrypoint. Only runs when this module is executed directly (not
// when imported by tests) — registers the SIGINT handler and performs the
// actual `process.exit`.
// ---------------------------------------------------------------------------

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  process.on('SIGINT', () => {
    process.exit(ExitCode.ABORTED);
  });
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

if (isMainModule()) {
  void main();
}
