import { describe, it, expect } from 'vitest';
import { CommanderError } from 'commander';
import { DecodeError, RmbgError, LamaError, PipelineAbortError } from 'nukebg-core';
import { exitCodeFor, IoError, NoInputError } from '../../src/util/errors.js';
import { LicenseRequiredError } from '../../src/license/gate.js';
import { ExitCode } from '../../src/util/exit-codes.js';

// ---------------------------------------------------------------------------
// Error -> exit code mapping (REQ-CLI-INVOCATION-6, design §H.3). Each real
// error class thrown by the codec/runners/license-gate/CLI layer maps to a
// specific sysexits-aligned code; anything unrecognised falls back to
// PIPELINE_FAILED (design §H.3's final `return` branch).
//
// `commander.CommanderError` is matched via real `instanceof` now that
// `commander` is an installed dependency (Phase 16 second pass).
// ---------------------------------------------------------------------------

describe('exitCodeFor', () => {
  it('maps PipelineAbortError to ExitCode.ABORTED (130)', () => {
    expect(exitCodeFor(new PipelineAbortError('aborted'))).toBe(ExitCode.ABORTED);
  });

  it('maps a real commander CommanderError to ExitCode.USER_ERROR (64)', () => {
    const err = new CommanderError(1, 'commander.unknownOption', 'unknown option');
    expect(exitCodeFor(err)).toBe(ExitCode.USER_ERROR);
  });

  it('maps LicenseRequiredError to ExitCode.LICENSE_REQUIRED (78)', () => {
    expect(exitCodeFor(new LicenseRequiredError('declined'))).toBe(ExitCode.LICENSE_REQUIRED);
  });

  it('maps DecodeError to ExitCode.INPUT_DECODE_FAILED (65)', () => {
    expect(exitCodeFor(new DecodeError('bad bytes'))).toBe(ExitCode.INPUT_DECODE_FAILED);
  });

  it('maps RmbgError to ExitCode.MODEL_DOWNLOAD_FAILED (74)', () => {
    expect(exitCodeFor(new RmbgError('download failed'))).toBe(ExitCode.MODEL_DOWNLOAD_FAILED);
  });

  it('maps LamaError to ExitCode.MODEL_DOWNLOAD_FAILED (74)', () => {
    expect(exitCodeFor(new LamaError('download failed'))).toBe(ExitCode.MODEL_DOWNLOAD_FAILED);
  });

  it('maps NoInputError to ExitCode.NO_INPUT (66)', () => {
    expect(exitCodeFor(new NoInputError('missing.png not found'))).toBe(ExitCode.NO_INPUT);
  });

  it('maps IoError to ExitCode.IO_ERROR (75)', () => {
    expect(exitCodeFor(new IoError('EACCES'))).toBe(ExitCode.IO_ERROR);
  });

  it('maps an unrecognised error to ExitCode.PIPELINE_FAILED (70)', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(ExitCode.PIPELINE_FAILED);
  });

  it('maps a non-Error thrown value to ExitCode.PIPELINE_FAILED (70)', () => {
    expect(exitCodeFor('some string')).toBe(ExitCode.PIPELINE_FAILED);
  });
});
