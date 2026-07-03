import { createInterface } from 'node:readline/promises';
import {
  ACKNOWLEDGED_TEXT,
  deleteMarker,
  readMarker,
  writeMarker,
} from './marker.js';
import type { LicenseMarker, MarkerIoOptions } from './marker.js';

// ---------------------------------------------------------------------------
// License gate state machine (design §G.3–§G.5, REQ-CLI-LICENSE-1,
// REQ-CLI-LICENSE-2). Gates access to RMBG-1.4 (CC-BY-NC-4.0, non-commercial
// only) behind an explicit acceptance recorded in the marker file.
//
// `assertAccepted` implements the five branches from design §G.5:
//   1. valid marker exists                              -> resolve
//   2. no marker, --accept-non-commercial flag           -> write marker, resolve
//   3. no marker, interactive TTY, user answers y        -> write marker, resolve
//   4. no marker, interactive TTY, user answers N/Enter  -> throw LicenseRequiredError
//   5. no marker, non-TTY, no flag                       -> throw LicenseRequiredError
//
// A corrupted/invalid marker is treated as absent (readMarker already
// returns null for those cases — see marker.ts), so it falls through to
// branches 2-5 exactly like "no marker".
// ---------------------------------------------------------------------------

/**
 * Thrown when the license has not been accepted and cannot be accepted
 * non-interactively. Phase 16 maps this to `ExitCode.LICENSE_REQUIRED` (78)
 * in `util/errors.ts`.
 */
export class LicenseRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseRequiredError';
  }
}

const LICENSE_BANNER = [
  'nukebg uses the RMBG-1.4 background-removal model, which is licensed',
  'under CC-BY-NC-4.0 (non-commercial use only). Commercial use requires a',
  'separate license from BRIA AI:',
  '  https://bria.ai/bria-huggingface-model-license-agreement/',
].join('\n');

export interface GateOptions extends MarkerIoOptions {
  /** `--accept-non-commercial` CLI flag value. */
  readonly acceptFlag?: boolean;
  /** Whether stdin/stderr are both TTYs. Defaults to the real terminal check. */
  readonly isInteractive?: boolean;
  /** Asks the user the accept/decline question, returns their raw answer. Injectable for testing. */
  readonly promptImpl?: () => Promise<string>;
  /** Sink for the license banner + prompt text. Defaults to `process.stderr`. */
  readonly stderrWrite?: (text: string) => void;
  /** CLI version recorded in the marker. Phase 16 wires the real value from `util/version.ts`. */
  readonly cliVersion?: string;
}

function defaultIsInteractive(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY);
}

async function defaultPrompt(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question('Accept non-commercial use? [y/N] ');
  } finally {
    rl.close();
  }
}

function buildMarker(cliVersion: string | undefined): LicenseMarker {
  return {
    version: 1,
    acceptedAt: new Date().toISOString(),
    acknowledged: ACKNOWLEDGED_TEXT,
    cliVersion: cliVersion ?? '0.0.0',
  };
}

/**
 * Write the marker unconditionally, recording acceptance. Used both by the
 * `--accept-non-commercial` branch and the interactive "y" branch, and
 * exposed standalone for the `nukebg license` subcommand (design §G.5).
 */
export async function accept(opts?: GateOptions): Promise<LicenseMarker> {
  const marker = buildMarker(opts?.cliVersion);
  await writeMarker(marker, opts);
  return marker;
}

/** Delete the marker file, reverting to "not accepted" (design §G.5). */
export async function revoke(opts?: MarkerIoOptions): Promise<void> {
  await deleteMarker(opts);
}

/** Current acceptance state — `null` when not accepted (missing or corrupted marker). */
export async function state(opts?: MarkerIoOptions): Promise<LicenseMarker | null> {
  return readMarker(opts);
}

/**
 * Ensure the license has been accepted, prompting or bypassing per the state
 * machine above. Resolves when acceptance is confirmed (existing marker,
 * flag, or interactive "y"); rejects with `LicenseRequiredError` otherwise.
 */
export async function assertAccepted(opts?: GateOptions): Promise<void> {
  const marker = await readMarker(opts);
  if (marker) return;

  if (opts?.acceptFlag) {
    await accept(opts);
    return;
  }

  const isInteractive = opts?.isInteractive ?? defaultIsInteractive();
  const stderrWrite = opts?.stderrWrite ?? ((text: string) => process.stderr.write(text));

  if (!isInteractive) {
    throw new LicenseRequiredError(
      `${LICENSE_BANNER}\n\nLicense required: pass --accept-non-commercial to proceed non-interactively.`,
    );
  }

  stderrWrite(`${LICENSE_BANNER}\n`);
  const promptImpl = opts?.promptImpl ?? defaultPrompt;
  const answer = await promptImpl();

  if (answer.trim().toLowerCase() === 'y') {
    await accept(opts);
    return;
  }

  throw new LicenseRequiredError(`${LICENSE_BANNER}\n\nLicense declined.`);
}
