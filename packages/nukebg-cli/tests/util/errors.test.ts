import { describe, it, expect } from 'vitest';
import { CommanderError } from 'commander';
import {
  DecodeError,
  RmbgError,
  LamaError,
  PipelineAbortError,
  PipelineTimeoutError,
} from 'nukebg-core';
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

  // 74 means "we could not obtain the model" and nothing else. These are the
  // only codes the ONNX runners throw for acquisition failures. Callers retry
  // 74 as a transient fault, so an inference error must never land here or a
  // retry loop never terminates.
  it('maps model acquisition failures to ExitCode.MODEL_DOWNLOAD_FAILED (74)', () => {
    for (const code of ['RMBG_DOWNLOAD_FAILED', 'RMBG_INTEGRITY_FAILED']) {
      expect(exitCodeFor(new RmbgError('acquire failed', { code }))).toBe(
        ExitCode.MODEL_DOWNLOAD_FAILED,
      );
    }
    for (const code of ['LAMA_DOWNLOAD_FAILED', 'LAMA_INTEGRITY_FAILED']) {
      expect(exitCodeFor(new LamaError('acquire failed', { code }))).toBe(
        ExitCode.MODEL_DOWNLOAD_FAILED,
      );
    }
  });

  // The defaults these errors carry are inference-flavoured (RMBG_FAILED /
  // LAMA_FAILED) — that is what runPipeline wraps a failed segment()/inpaint()
  // in. Those are deterministic pipeline failures, not download problems.
  it('maps model inference failures to ExitCode.PIPELINE_FAILED (70)', () => {
    expect(exitCodeFor(new RmbgError('RMBG segmentation failed'))).toBe(ExitCode.PIPELINE_FAILED);
    expect(exitCodeFor(new LamaError('LaMa inpaint failed'))).toBe(ExitCode.PIPELINE_FAILED);
  });

  // A timeout is not a generic pipeline failure: it is retryable, and folding
  // it into 70 would lose that. 124 matches GNU timeout(1), which is what
  // scripts already branch on — the sysexits range (64-78) has no slot for
  // "took too long". See issue #328.
  it('maps PipelineTimeoutError to ExitCode.TIMEOUT (124)', () => {
    expect(exitCodeFor(new PipelineTimeoutError('RMBG segmentation', 300_000))).toBe(
      ExitCode.TIMEOUT,
    );
    expect(ExitCode.TIMEOUT).toBe(124);
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
