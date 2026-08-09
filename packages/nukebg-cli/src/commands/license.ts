import { revoke, state } from '../license/gate.js';
import type { GateOptions } from '../license/gate.js';

// ---------------------------------------------------------------------------
// `nukebg license` subcommand (REQ-CLI-LICENSE-4).
//
// Prints acceptance status, or with `--revoke` deletes the marker file.
// Output goes to an injectable stdout sink so this is testable without
// capturing `process.stdout` globally. Exits 0 in all cases here — Phase 16
// wires this return value into the real `process.exit`; a filesystem error
// propagates as a thrown error for Phase 16's top-level handler to map to
// exit 1 (per REQ-CLI-LICENSE-4).
// ---------------------------------------------------------------------------

const LICENSE_NOTICE = [
  'RMBG-1.4 is licensed under CC-BY-NC-4.0 (non-commercial use only).',
  'Commercial use requires a separate license from BRIA AI:',
  '  https://bria.ai/bria-huggingface-model-license-agreement/',
].join('\n');

export interface LicenseCommandOptions extends GateOptions {
  /** `--revoke` flag: delete the marker instead of printing status. */
  readonly revoke?: boolean;
  /** Sink for command output. Defaults to `process.stdout`. */
  readonly stdoutWrite?: (text: string) => void;
}

export async function runLicenseCommand(opts?: LicenseCommandOptions): Promise<number> {
  const stdoutWrite = opts?.stdoutWrite ?? ((text: string) => process.stdout.write(text));

  if (opts?.revoke) {
    await revoke(opts);
    stdoutWrite('License acceptance revoked. The marker file has been deleted.\n');
    return 0;
  }

  const marker = await state(opts);

  if (marker) {
    stdoutWrite(
      [
        'Status: accepted',
        `Accepted at: ${marker.acceptedAt}`,
        `Acknowledged: ${marker.acknowledged}`,
        '',
        LICENSE_NOTICE,
        '',
      ].join('\n'),
    );
  } else {
    stdoutWrite(['Status: not accepted', '', LICENSE_NOTICE, ''].join('\n'));
  }

  return 0;
}
