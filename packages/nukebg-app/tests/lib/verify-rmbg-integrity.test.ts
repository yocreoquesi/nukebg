import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RMBG_PARAMS } from 'nukebg-core';
import { verifyRmbgIntegrity } from '../../src/lib/verify-rmbg-integrity';

/**
 * Unit tests for the RMBG supply-chain check (#397).
 *
 * These are only possible because the check moved out of `ml.worker.ts`.
 * While it lived inside the worker it could not be exercised directly, and
 * that is not incidental to how the gap arose: a control nobody can call in
 * isolation is a control nobody notices is missing from the other path.
 *
 * `crypto.subtle.digest` is stubbed rather than fed real bytes. The point is
 * not to re-test SHA-256; it is to pin what this function does with the
 * digest once it has one — accept, or evict and throw.
 */

const ORIGINAL_CACHES = globalThis.caches;

function mockCache(entry: { byteLength: number } | null) {
  const del = vi.fn(() => Promise.resolve(true));
  const cache = {
    match: vi.fn(() =>
      Promise.resolve(
        entry === null
          ? undefined
          : ({ arrayBuffer: () => Promise.resolve(entry as unknown as ArrayBuffer) } as Response),
      ),
    ),
    delete: del,
  };
  vi.stubGlobal('caches', { open: vi.fn(() => Promise.resolve(cache as unknown as Cache)) });
  return { cache, del };
}

/** Make `crypto.subtle.digest` yield exactly `hex`. */
function stubDigest(hex: string) {
  const bytes = new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: { digest: vi.fn(() => Promise.resolve(bytes.buffer)) },
  });
}

describe('verifyRmbgIntegrity (#397)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.caches = ORIGINAL_CACHES;
  });

  describe('accepts the audited model', () => {
    it('resolves without evicting when size and hash both match', async () => {
      const { del } = mockCache({ byteLength: RMBG_PARAMS.EXPECTED_SIZE });
      stubDigest(RMBG_PARAMS.EXPECTED_SHA256);

      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).resolves.toBeUndefined();
      expect(del).not.toHaveBeenCalled();
    });
  });

  describe('rejects and evicts anything else', () => {
    it('throws on a size mismatch, before hashing anything', async () => {
      const { del } = mockCache({ byteLength: RMBG_PARAMS.EXPECTED_SIZE - 1 });
      const digest = vi.fn();
      vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: { digest } });

      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).rejects.toThrow(/size mismatch/);
      expect(del).toHaveBeenCalledWith(RMBG_PARAMS.MODEL_URL);
      // Cheap check first: no point hashing 45MB that is already the wrong length.
      expect(digest).not.toHaveBeenCalled();
    });

    it('throws on a hash mismatch even when the size is right', async () => {
      const { del } = mockCache({ byteLength: RMBG_PARAMS.EXPECTED_SIZE });
      stubDigest('0'.repeat(64));

      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).rejects.toThrow(/hash mismatch/);
      expect(del).toHaveBeenCalledWith(RMBG_PARAMS.MODEL_URL);
    });

    it('names both digests in the error, so a mismatch is diagnosable', async () => {
      mockCache({ byteLength: RMBG_PARAMS.EXPECTED_SIZE });
      stubDigest('a'.repeat(64));

      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).rejects.toThrow(
        new RegExp(`got ${'a'.repeat(64)}, expected ${RMBG_PARAMS.EXPECTED_SHA256}`),
      );
    });
  });

  describe('degrades quietly rather than blocking a working install', () => {
    /*
     * Each of these is a deliberate skip, and each also means a passing call
     * is NOT proof the bytes were checked. Only a throw proves they were
     * checked and failed. The module header says so; these pin the cases.
     */

    it('skips when the Cache API is unavailable', async () => {
      vi.stubGlobal('caches', undefined);
      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).resolves.toBeUndefined();
    });

    it('skips when caches.open rejects, e.g. a cross-origin restriction', async () => {
      vi.stubGlobal('caches', { open: vi.fn(() => Promise.reject(new Error('denied'))) });
      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).resolves.toBeUndefined();
    });

    it('skips, with a warning, when the blob is not cached', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { del } = mockCache(null);

      await expect(verifyRmbgIntegrity('briaai/RMBG-1.4')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/integrity check skipped/));
      expect(del).not.toHaveBeenCalled();
    });

    it('ignores a model it has no audited hash for', async () => {
      const opened = vi.fn();
      vi.stubGlobal('caches', { open: opened });

      await expect(verifyRmbgIntegrity('some/other-model')).resolves.toBeUndefined();
      // Returns before touching the cache at all.
      expect(opened).not.toHaveBeenCalled();
    });
  });
});
