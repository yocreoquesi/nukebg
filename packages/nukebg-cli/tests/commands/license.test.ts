import { describe, it, expect, vi } from 'vitest';
import { runLicenseCommand } from '../../src/commands/license.js';
import type { LicenseMarker } from '../../src/license/marker.js';

// ---------------------------------------------------------------------------
// `nukebg license` subcommand (REQ-CLI-LICENSE-4). Output is written to
// injectable stdout/stderr sinks so no global capture is needed.
// ---------------------------------------------------------------------------

const VALID_MARKER: LicenseMarker = {
  version: 1,
  acceptedAt: '2026-05-10T00:00:00.000Z',
  acknowledged: 'RMBG-1.4 CC-BY-NC-4.0',
  cliVersion: '0.1.0',
};

describe('runLicenseCommand', () => {
  it('prints Status: accepted, the acceptance timestamp, and the CC-BY-NC-4.0 notice when a marker exists', async () => {
    const readFileImpl = vi.fn(async () => JSON.stringify(VALID_MARKER));
    const lines: string[] = [];
    const stdoutWrite = (text: string) => lines.push(text);

    const exitCode = await runLicenseCommand({ readFileImpl, stdoutWrite });

    const output = lines.join('');
    expect(output).toContain('Status: accepted');
    expect(output).toContain(VALID_MARKER.acceptedAt);
    expect(output).toContain('CC-BY-NC-4.0');
    expect(exitCode).toBe(0);
  });

  it('prints Status: not accepted when no marker exists', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const lines: string[] = [];
    const stdoutWrite = (text: string) => lines.push(text);

    const exitCode = await runLicenseCommand({ readFileImpl, stdoutWrite });

    expect(lines.join('')).toContain('Status: not accepted');
    expect(exitCode).toBe(0);
  });

  it('deletes the marker and prints a confirmation when --revoke is passed', async () => {
    const unlinkImpl = vi.fn(async () => undefined);
    const lines: string[] = [];
    const stdoutWrite = (text: string) => lines.push(text);

    const exitCode = await runLicenseCommand({ revoke: true, unlinkImpl, stdoutWrite });

    expect(unlinkImpl).toHaveBeenCalledTimes(1);
    expect(lines.join('').toLowerCase()).toContain('revoke');
    expect(exitCode).toBe(0);
  });
});
