import { describe, it, expect, vi } from 'vitest';
import { readMarker, writeMarker, deleteMarker, markerPath } from '../../src/license/marker.js';
import type { LicenseMarker } from '../../src/license/marker.js';

// ---------------------------------------------------------------------------
// LicenseMarker read/write/validate (REQ-CLI-LICENSE-3). All fs access goes
// through injectable seams (readFileImpl/writeFileImpl/renameImpl/unlinkImpl)
// so these are pure unit tests with zero real disk I/O.
// ---------------------------------------------------------------------------

const VALID_MARKER: LicenseMarker = {
  version: 1,
  acceptedAt: '2026-05-10T00:00:00.000Z',
  acknowledged: 'RMBG-1.4 CC-BY-NC-4.0',
  cliVersion: '0.1.0',
};

describe('readMarker', () => {
  it('returns the parsed LicenseMarker when the file contains valid JSON with correct version and acknowledged', async () => {
    const readFileImpl = vi.fn(async () => JSON.stringify(VALID_MARKER));

    const result = await readMarker({ readFileImpl });

    expect(result).toEqual(VALID_MARKER);
    expect(readFileImpl).toHaveBeenCalledWith(markerPath());
  });

  it('returns null when the file contains invalid JSON', async () => {
    const readFileImpl = vi.fn(async () => '{not valid json');

    const result = await readMarker({ readFileImpl });

    expect(result).toBeNull();
  });

  it('returns null when the marker version is not 1', async () => {
    const readFileImpl = vi.fn(async () => JSON.stringify({ ...VALID_MARKER, version: 2 }));

    const result = await readMarker({ readFileImpl });

    expect(result).toBeNull();
  });

  it('returns null when the acknowledged string does not match', async () => {
    const readFileImpl = vi.fn(async () => JSON.stringify({ ...VALID_MARKER, acknowledged: 'wrong' }));

    const result = await readMarker({ readFileImpl });

    expect(result).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await readMarker({ readFileImpl });

    expect(result).toBeNull();
  });
});

describe('writeMarker', () => {
  it('writes atomically: writes to a .tmp file then renames it into place', async () => {
    const writeFileImpl = vi.fn(async () => undefined);
    const renameImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);

    await writeMarker(VALID_MARKER, { writeFileImpl, renameImpl, mkdirImpl });

    expect(writeFileImpl).toHaveBeenCalledTimes(1);
    const call = writeFileImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [writtenPath, writtenData] = call as unknown as [string, string];
    expect(writtenPath).toBe(`${markerPath()}.tmp`);
    expect(JSON.parse(writtenData)).toEqual(VALID_MARKER);

    expect(renameImpl).toHaveBeenCalledTimes(1);
    expect(renameImpl).toHaveBeenCalledWith(`${markerPath()}.tmp`, markerPath());
  });
});

describe('deleteMarker', () => {
  it('unlinks the marker file', async () => {
    const unlinkImpl = vi.fn(async () => undefined);

    await deleteMarker({ unlinkImpl });

    expect(unlinkImpl).toHaveBeenCalledWith(markerPath());
  });

  it('does not throw when the marker file does not already exist', async () => {
    const unlinkImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await expect(deleteMarker({ unlinkImpl })).resolves.toBeUndefined();
  });
});
