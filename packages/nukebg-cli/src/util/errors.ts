import { CommanderError } from 'commander';
import {
  PipelineAbortError,
  PipelineTimeoutError,
  DecodeError,
  RmbgError,
  LamaError,
} from 'nukebg-core';
import { LicenseRequiredError } from '../license/gate.js';
import { ExitCode } from './exit-codes.js';

// ---------------------------------------------------------------------------
// Error -> exit code mapping (design §H.3, REQ-CLI-INVOCATION-6). Mapped
// against what the CLI's own layers ACTUALLY throw, not design §H.3's sketch
// names (`ImageDecodeError`/`ModelLoadError`/`IoError` as originally
// sketched don't match the real thrown types except `IoError`, which we do
// define here since nothing else provides it):
//   - `PipelineAbortError`   (nukebg-core)        -> ABORTED (130)
//   - `commander.CommanderError`                  -> USER_ERROR (64)
//     Real `instanceof commander.CommanderError` now that `commander` is an
//     installed dependency (Phase 16 second pass — it was NOT resolvable
//     when this mapping was first written, so a `name === 'CommanderError'`
//     duck-type was used instead; upgraded to `instanceof` once the real
//     package became available). NOTE: `cli.ts`'s own `runCli` catches
//     `CommanderError` directly around `program.parseAsync()` to
//     distinguish `--help`/`--version` (exit 0) from real usage errors
//     (exit 64) using `err.exitCode`, which this generic mapping can't do
//     (it always returns 64) — this branch exists for completeness / any
//     `CommanderError` that propagates through another path.
//   - `LicenseRequiredError` (../license/gate.js) -> LICENSE_REQUIRED (78)
//   - `NoInputError`         (this file)          -> NO_INPUT (66, additive — see exit-codes.ts)
//   - `DecodeError`          (nukebg-core)        -> INPUT_DECODE_FAILED (65)
//   - `RmbgError`/`LamaError` (nukebg-core)       -> MODEL_DOWNLOAD_FAILED (74)
//   - `IoError`              (this file)          -> IO_ERROR (75)
//   - anything else                               -> PIPELINE_FAILED (70)
// ---------------------------------------------------------------------------

interface NamedErrorOpts {
  readonly cause?: unknown;
}

/**
 * Thrown when the `<input>` path does not exist / cannot be opened, distinct
 * from `DecodeError` (file exists but bytes aren't a recognised image).
 * Maps to `ExitCode.NO_INPUT` (66, REQ-CLI-INVOCATION-2).
 */
export class NoInputError extends Error {
  constructor(message: string, opts?: NamedErrorOpts) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'NoInputError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown for fs read/write failures that are neither "file not found" for
 * the input (`NoInputError`) nor an unrecognised image format
 * (`DecodeError`) — e.g. EACCES, ENOSPC on the output write, or a read
 * failure other than ENOENT. Maps to `ExitCode.IO_ERROR` (75).
 */
export class IoError extends Error {
  constructor(message: string, opts?: NamedErrorOpts) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'IoError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * `RmbgError`/`LamaError` codes that mean "we could not obtain the model",
 * as opposed to "the model ran and failed". Kept in sync with the codes the
 * ONNX runners throw in `onnx-node-rmbg.ts` / `onnx-node-lama.ts`.
 */
const MODEL_ACQUISITION_CODES = new Set([
  'RMBG_DOWNLOAD_FAILED',
  'RMBG_INTEGRITY_FAILED',
  'LAMA_DOWNLOAD_FAILED',
  'LAMA_INTEGRITY_FAILED',
]);

export function exitCodeFor(err: unknown): number {
  if (err instanceof PipelineAbortError) return ExitCode.ABORTED;
  if (err instanceof PipelineTimeoutError) return ExitCode.TIMEOUT;
  if (err instanceof CommanderError) return ExitCode.USER_ERROR;
  if (err instanceof LicenseRequiredError) return ExitCode.LICENSE_REQUIRED;
  if (err instanceof NoInputError) return ExitCode.NO_INPUT;
  if (err instanceof DecodeError) return ExitCode.INPUT_DECODE_FAILED;
  if (err instanceof RmbgError || err instanceof LamaError) {
    // Discriminate on the `code` the error already carries, not on its class.
    // Only model acquisition — download or integrity — is a 74; an inference
    // failure (ORT run error, OOM on a large image) is a pipeline failure.
    // Collapsing both onto 74 told callers "model download failed" for
    // deterministic errors, so a CI wrapper retrying 74 as a transient network
    // fault would retry the same image forever, and 70 was unreachable for
    // every ML-stage failure.
    return MODEL_ACQUISITION_CODES.has(err.code)
      ? ExitCode.MODEL_DOWNLOAD_FAILED
      : ExitCode.PIPELINE_FAILED;
  }
  if (err instanceof IoError) return ExitCode.IO_ERROR;
  return ExitCode.PIPELINE_FAILED;
}
