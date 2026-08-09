import { describe, it, expect, vi } from 'vitest';
import { assertAccepted, LicenseRequiredError } from '../../src/license/gate.js';
import type { LicenseMarker } from '../../src/license/marker.js';

// ---------------------------------------------------------------------------
// Gate state machine (design §G.5, REQ-CLI-LICENSE-1, REQ-CLI-LICENSE-2). All
// five branches are covered. Marker fs access and the interactive prompt are
// both injected so no real disk I/O or terminal is needed.
// ---------------------------------------------------------------------------

const VALID_MARKER: LicenseMarker = {
  version: 1,
  acceptedAt: '2026-05-10T00:00:00.000Z',
  acknowledged: 'RMBG-1.4 CC-BY-NC-4.0',
  cliVersion: '0.1.0',
};

function validMarkerReadFileImpl() {
  return vi.fn(async () => JSON.stringify(VALID_MARKER));
}

function noMarkerReadFileImpl() {
  return vi.fn(async () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

describe('assertAccepted', () => {
  it('resolves without prompting when a valid marker exists', async () => {
    const readFileImpl = validMarkerReadFileImpl();
    const promptImpl = vi.fn();

    await expect(
      assertAccepted({ readFileImpl, promptImpl, isInteractive: true }),
    ).resolves.toBeUndefined();

    expect(promptImpl).not.toHaveBeenCalled();
  });

  it('writes the marker and resolves when no marker exists and --accept-non-commercial is passed', async () => {
    const readFileImpl = noMarkerReadFileImpl();
    const writeFileImpl = vi.fn(async () => undefined);
    const renameImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const promptImpl = vi.fn();

    await expect(
      assertAccepted({
        acceptFlag: true,
        isInteractive: false,
        readFileImpl,
        writeFileImpl,
        renameImpl,
        mkdirImpl,
        promptImpl,
      }),
    ).resolves.toBeUndefined();

    expect(writeFileImpl).toHaveBeenCalledTimes(1);
    expect(renameImpl).toHaveBeenCalledTimes(1);
    expect(promptImpl).not.toHaveBeenCalled();
  });

  it('prompts, writes the marker, and resolves when no marker exists, TTY is interactive, and the user answers y', async () => {
    const readFileImpl = noMarkerReadFileImpl();
    const writeFileImpl = vi.fn(async () => undefined);
    const renameImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const promptImpl = vi.fn(async () => 'y');
    const stderrWrite = vi.fn();

    await expect(
      assertAccepted({
        isInteractive: true,
        readFileImpl,
        writeFileImpl,
        renameImpl,
        mkdirImpl,
        promptImpl,
        stderrWrite,
      }),
    ).resolves.toBeUndefined();

    expect(promptImpl).toHaveBeenCalledTimes(1);
    expect(writeFileImpl).toHaveBeenCalledTimes(1);
  });

  it('throws LicenseRequiredError when no marker exists, TTY is interactive, and the user answers N (or Enter)', async () => {
    const readFileImpl = noMarkerReadFileImpl();
    const writeFileImpl = vi.fn(async () => undefined);
    const promptImpl = vi.fn(async () => '');
    const stderrWrite = vi.fn();

    await expect(
      assertAccepted({ isInteractive: true, readFileImpl, writeFileImpl, promptImpl, stderrWrite }),
    ).rejects.toBeInstanceOf(LicenseRequiredError);

    expect(writeFileImpl).not.toHaveBeenCalled();
  });

  it('throws LicenseRequiredError immediately when no marker exists, non-TTY, and no flag', async () => {
    const readFileImpl = noMarkerReadFileImpl();
    const promptImpl = vi.fn();

    await expect(
      assertAccepted({ isInteractive: false, readFileImpl, promptImpl }),
    ).rejects.toBeInstanceOf(LicenseRequiredError);

    expect(promptImpl).not.toHaveBeenCalled();
  });

  it('treats a corrupted marker as absent and prompts when interactive', async () => {
    const readFileImpl = vi.fn(async () => '{not valid json');
    const writeFileImpl = vi.fn(async () => undefined);
    const renameImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const promptImpl = vi.fn(async () => 'y');
    const stderrWrite = vi.fn();

    await expect(
      assertAccepted({
        isInteractive: true,
        readFileImpl,
        writeFileImpl,
        renameImpl,
        mkdirImpl,
        promptImpl,
        stderrWrite,
      }),
    ).resolves.toBeUndefined();

    expect(promptImpl).toHaveBeenCalledTimes(1);
  });
});
