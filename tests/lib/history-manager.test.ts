import { describe, it, expect } from 'vitest';
import { HistoryManager } from '../../src/lib/history-manager';

/**
 * Behavioural tests for the generic undo/redo manager extracted from
 * ar-editor.ts in #47/Phase-2.
 */
describe('HistoryManager', () => {
  describe('push + undo/redo round-trip', () => {
    it('returns the most recent push on undo', () => {
      const h = new HistoryManager<string>();
      h.push('a');
      h.push('b');
      h.push('c');

      expect(h.undo('current')).toBe('c');
      expect(h.undo('c-was-current')).toBe('b');
      expect(h.undo('b-was-current')).toBe('a');
    });

    it('moves current state onto redo stack during undo', () => {
      const h = new HistoryManager<string>();
      h.push('a');
      h.undo('current'); // current goes to redo stack
      expect(h.canRedo()).toBe(true);
      expect(h.redo('a')).toBe('current');
    });

    it('round-trips undo → redo with state preserved', () => {
      const h = new HistoryManager<number>();
      h.push(1);
      h.push(2);
      const undone = h.undo(3);
      expect(undone).toBe(2);
      const redone = h.redo(undone!);
      expect(redone).toBe(3);
    });

    it('returns null when stacks are empty', () => {
      const h = new HistoryManager<string>();
      expect(h.undo('x')).toBeNull();
      expect(h.redo('x')).toBeNull();
    });
  });

  describe('redo invalidation', () => {
    it('clears the redo stack when push is called after undo', () => {
      const h = new HistoryManager<string>();
      h.push('a');
      h.push('b');
      h.undo('current');
      expect(h.canRedo()).toBe(true);

      h.push('new-branch');
      expect(h.canRedo()).toBe(false);
    });
  });

  describe('cap policy', () => {
    it('drops the oldest entry when maxEntries is exceeded', () => {
      const h = new HistoryManager<string>(3);
      h.push('a');
      h.push('b');
      h.push('c');
      h.push('d'); // evicts 'a'

      // Walk back as far as we can
      expect(h.undo('current')).toBe('d');
      expect(h.undo('d')).toBe('c');
      expect(h.undo('c')).toBe('b');
      // 'a' was evicted, no more entries
      expect(h.undo('b')).toBeNull();
    });

    it('uses default cap of 12 when not specified', () => {
      const h = new HistoryManager<number>();
      for (let i = 0; i < 15; i++) h.push(i);

      // 15 pushed, cap 12 → entries [3..14] should remain
      const seen: number[] = [];
      let cur = 99;
      while (h.canUndo()) {
        const v = h.undo(cur);
        if (v !== null) {
          seen.push(v);
          cur = v;
        }
      }
      expect(seen).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });
  });

  describe('canUndo / canRedo', () => {
    it('reports false on a fresh manager', () => {
      const h = new HistoryManager();
      expect(h.canUndo()).toBe(false);
      expect(h.canRedo()).toBe(false);
    });

    it('flips true after push', () => {
      const h = new HistoryManager<number>();
      h.push(1);
      expect(h.canUndo()).toBe(true);
      expect(h.canRedo()).toBe(false);
    });
  });

  describe('clear', () => {
    it('wipes both stacks', () => {
      const h = new HistoryManager<string>();
      h.push('a');
      h.push('b');
      h.undo('current');

      h.clear();

      expect(h.canUndo()).toBe(false);
      expect(h.canRedo()).toBe(false);
      expect(h.undo('x')).toBeNull();
      expect(h.redo('x')).toBeNull();
    });
  });

  describe('works with non-trivial state types', () => {
    it('handles Uint8ClampedArray snapshots without issue', () => {
      const h = new HistoryManager<Uint8ClampedArray>();
      const a = new Uint8ClampedArray([1, 2, 3, 4]);
      const b = new Uint8ClampedArray([5, 6, 7, 8]);
      h.push(a);
      h.push(b);

      const cur = new Uint8ClampedArray([9, 9, 9, 9]);
      const undone = h.undo(cur);
      expect(undone).toBe(b); // identity preserved (no clone)
    });
  });
});
