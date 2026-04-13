import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createZip, padIndex, safeZipEntryName } from '../../src/utils/zip';

describe('padIndex', () => {
  it('pads single digit when total is 12', () => {
    expect(padIndex(1, 12)).toBe('01');
    expect(padIndex(9, 12)).toBe('09');
    expect(padIndex(12, 12)).toBe('12');
  });

  it('does not pad when total is 6 (one digit)', () => {
    expect(padIndex(1, 6)).toBe('1');
    expect(padIndex(6, 6)).toBe('6');
  });

  it('pads to 3 digits when total is 100', () => {
    expect(padIndex(1, 100)).toBe('001');
    expect(padIndex(42, 100)).toBe('042');
  });
});

describe('safeZipEntryName', () => {
  it('replaces original extension with .png', () => {
    expect(safeZipEntryName(1, 12, 'cat.jpg')).toBe('nukebg-01-cat.png');
    expect(safeZipEntryName(3, 12, 'logo.webp')).toBe('nukebg-03-logo.png');
  });

  it('strips unsafe characters', () => {
    expect(safeZipEntryName(1, 12, 'file/with:bad*chars?.png'))
      .toBe('nukebg-01-file_with_bad_chars_.png');
  });

  it('falls back to "image" when base name is empty', () => {
    expect(safeZipEntryName(1, 12, '.png')).toBe('nukebg-01-image.png');
  });

  it('truncates long names', () => {
    const longName = 'a'.repeat(200) + '.png';
    const result = safeZipEntryName(1, 12, longName);
    expect(result.length).toBeLessThan(80);
    expect(result).toMatch(/^nukebg-01-a+\.png$/);
  });
});

describe('createZip', () => {
  it('throws on empty file list', async () => {
    await expect(createZip([])).rejects.toThrow(/empty/);
  });

  it('produces a valid ZIP with the given files', async () => {
    const blob1 = new Blob(['hello'], { type: 'text/plain' });
    const blob2 = new Blob(['world'], { type: 'text/plain' });
    const zipBlob = await createZip([
      { name: 'a.txt', blob: blob1 },
      { name: 'b.txt', blob: blob2 },
    ]);

    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.size).toBeGreaterThan(0);

    // Round-trip: re-open the ZIP and verify contents
    const reopened = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const aContent = await reopened.file('a.txt')!.async('string');
    const bContent = await reopened.file('b.txt')!.async('string');
    expect(aContent).toBe('hello');
    expect(bContent).toBe('world');
  });
});
