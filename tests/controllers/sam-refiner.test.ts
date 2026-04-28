import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks for ../../src/refine/loaders/mobile-sam ──────────────────────
// Hoisted so vi.mock can hoist them above the SamRefiner import below.
const { loadSamMock, encodeSamMock, decodeSamMock, disposeSamMock, onSamProgressMock } = vi.hoisted(
  () => ({
    loadSamMock: vi.fn(() => Promise.resolve()),
    encodeSamMock: vi.fn(() => Promise.resolve()),
    decodeSamMock: vi.fn(() => Promise.resolve({ mask: new Uint8Array(16), width: 4, height: 4 })),
    disposeSamMock: vi.fn(),
    onSamProgressMock: vi.fn(),
  }),
);

vi.mock('../../src/refine/loaders/mobile-sam', () => ({
  loadSam: loadSamMock,
  encodeSam: encodeSamMock,
  decodeSam: decodeSamMock,
  disposeSam: disposeSamMock,
  onSamProgress: onSamProgressMock,
}));

import { SamRefiner } from '../../src/controllers/sam-refiner';

beforeEach(() => {
  loadSamMock.mockClear();
  encodeSamMock.mockClear();
  decodeSamMock.mockClear();
  disposeSamMock.mockClear();
  onSamProgressMock.mockClear();
});

const ac = (): AbortController => new AbortController();

describe('SamRefiner', () => {
  describe('ensureEncoded', () => {
    it('runs load + encode then flips isEncoded() to true', async () => {
      const r = new SamRefiner();
      expect(r.isEncoded()).toBe(false);

      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      expect(loadSamMock).toHaveBeenCalledTimes(1);
      expect(encodeSamMock).toHaveBeenCalledTimes(1);
      expect(encodeSamMock).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 4, 4);
      expect(r.isEncoded()).toBe(true);
    });

    it('is idempotent — second call skips load + encode', async () => {
      const r = new SamRefiner();
      const signal = ac().signal;
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, signal);
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, signal);

      expect(loadSamMock).toHaveBeenCalledTimes(1);
      expect(encodeSamMock).toHaveBeenCalledTimes(1);
    });

    it('wires the progress callback before load and clears it after', async () => {
      const cb = vi.fn();
      const r = new SamRefiner(cb);
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      expect(onSamProgressMock).toHaveBeenCalledTimes(2);
      expect(onSamProgressMock.mock.calls[0][0]).toBe(cb);
      expect(onSamProgressMock.mock.calls[1][0]).toBeNull();
    });

    it('does not touch onSamProgress if no callback was supplied', async () => {
      const r = new SamRefiner();
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);
      expect(onSamProgressMock).not.toHaveBeenCalled();
    });

    it('throws AbortError when signal is already aborted before load', async () => {
      const r = new SamRefiner();
      const c = ac();
      c.abort();

      await expect(r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, c.signal)).rejects.toThrowError(
        /Aborted/,
      );
      expect(loadSamMock).not.toHaveBeenCalled();
      expect(r.isEncoded()).toBe(false);
    });

    it('clears the progress callback even when aborted mid-flight', async () => {
      const cb = vi.fn();
      const r = new SamRefiner(cb);
      const c = ac();
      // Abort right after load resolves but before encode would run.
      loadSamMock.mockImplementationOnce(() => {
        c.abort();
        return Promise.resolve();
      });

      await expect(r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, c.signal)).rejects.toThrowError(
        /Aborted/,
      );
      // First call wires cb, finally clears it.
      expect(onSamProgressMock).toHaveBeenCalledTimes(2);
      expect(onSamProgressMock.mock.calls[1][0]).toBeNull();
    });
  });

  describe('decode', () => {
    it('throws if called before ensureEncoded', async () => {
      const r = new SamRefiner();
      await expect(r.decode([{ x: 0, y: 0 }], [1], 4, 4)).rejects.toThrow(/before ensureEncoded/);
      expect(decodeSamMock).not.toHaveBeenCalled();
    });

    it('passes args through to decodeSam after encode', async () => {
      const r = new SamRefiner();
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      const result = await r.decode([{ x: 1, y: 1 }], [2], 4, 4);
      expect(decodeSamMock).toHaveBeenCalledWith([{ x: 1, y: 1 }], [2], 4, 4);
      expect(result.mask).toBeInstanceOf(Uint8Array);
    });
  });

  describe('invalidate', () => {
    it('flips isEncoded() back to false so the next ensureEncoded re-runs', async () => {
      const r = new SamRefiner();
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);
      expect(r.isEncoded()).toBe(true);

      r.invalidate();
      expect(r.isEncoded()).toBe(false);

      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);
      expect(loadSamMock).toHaveBeenCalledTimes(2);
      expect(encodeSamMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispose', () => {
    it('calls disposeSam and resets isEncoded()', async () => {
      const r = new SamRefiner();
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      r.dispose();
      expect(disposeSamMock).toHaveBeenCalledTimes(1);
      expect(r.isEncoded()).toBe(false);
    });
  });

  describe('setProgressCallback', () => {
    it('replaces the callback used by the next ensureEncoded', async () => {
      const r = new SamRefiner();
      const cb = vi.fn();
      r.setProgressCallback(cb);
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      expect(onSamProgressMock.mock.calls[0][0]).toBe(cb);
    });

    it('detaches when passed null', async () => {
      const cb = vi.fn();
      const r = new SamRefiner(cb);
      r.setProgressCallback(null);
      await r.ensureEncoded(new Uint8ClampedArray(64), 4, 4, ac().signal);

      // No progress wiring at all (null detaches before ensureEncoded gates).
      expect(onSamProgressMock).not.toHaveBeenCalled();
    });
  });
});
