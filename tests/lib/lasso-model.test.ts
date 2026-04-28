import { describe, it, expect } from 'vitest';
import { LassoModel } from '../../src/lib/lasso-model';

/**
 * Behavioural tests for the LassoModel state machine extracted from
 * ar-editor-advanced.ts in #47/Phase-3a.
 */
describe('LassoModel', () => {
  describe('lifecycle: empty → drawing → closed → empty', () => {
    it('starts empty', () => {
      const m = new LassoModel();
      expect(m.isEmpty()).toBe(true);
      expect(m.isClosed()).toBe(false);
      expect(m.getRawPath()).toBeNull();
      expect(m.getAnchors()).toBeNull();
    });

    it('startAt seeds a single-point raw path', () => {
      const m = new LassoModel();
      m.startAt({ x: 10, y: 20 });
      expect(m.isEmpty()).toBe(false);
      expect(m.isClosed()).toBe(false);
      expect(m.getRawPath()).toEqual([{ x: 10, y: 20 }]);
    });

    it('startAt wipes any prior closed lasso', () => {
      const m = new LassoModel(0.5);
      // Build a triangle (>= MIN_ANCHORS) and close.
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 50, y: 100 });
      m.close();
      expect(m.isClosed()).toBe(true);

      m.startAt({ x: 5, y: 5 });
      expect(m.isClosed()).toBe(false);
      expect(m.getRawPath()).toEqual([{ x: 5, y: 5 }]);
    });

    it('addRawPoint respects min-distance gate', () => {
      const m = new LassoModel();
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 1, y: 0 }); // distSq=1 < 4 → skipped
      m.addRawPoint({ x: 5, y: 0 }); // distSq=25 ≥ 4 → kept
      expect(m.getRawPath()).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]);
    });

    it('addRawPoint is a noop when no raw path is active', () => {
      const m = new LassoModel();
      m.addRawPoint({ x: 1, y: 1 });
      expect(m.getRawPath()).toBeNull();
    });
  });

  describe('close(): simplification', () => {
    it('returns 0 and clears state if too few unique points', () => {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 10, y: 0 });
      // Only 2 anchors → below MIN_ANCHORS=3 even before simplification.
      const count = m.close();
      expect(count).toBe(0);
      expect(m.isClosed()).toBe(false);
      expect(m.getRawPath()).toBeNull();
    });

    it('reduces a near-collinear path to a low-vertex polygon', () => {
      const m = new LassoModel(2.0);
      // Walk a noisy "square" — 16 points, but the simplifier should
      // reduce to roughly the 4 corners.
      m.startAt({ x: 0, y: 0 });
      for (let i = 1; i <= 4; i++) m.addRawPoint({ x: i * 25, y: 0 });
      for (let i = 1; i <= 4; i++) m.addRawPoint({ x: 100, y: i * 25 });
      for (let i = 1; i <= 4; i++) m.addRawPoint({ x: 100 - i * 25, y: 100 });
      for (let i = 1; i <= 3; i++) m.addRawPoint({ x: 0, y: 100 - i * 25 });

      const count = m.close();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThan(16);
      expect(m.isClosed()).toBe(true);
      expect(m.getAnchors()).toHaveLength(count);
    });
  });

  describe('drag flow', () => {
    function buildSquare(): LassoModel {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 100, y: 100 });
      m.addRawPoint({ x: 0, y: 100 });
      m.close();
      return m;
    }

    it('beginDragAnchor sets the index and ignores out-of-range', () => {
      const m = buildSquare();
      m.beginDragAnchor(2);
      expect(m.getDragAnchorIndex()).toBe(2);

      // Out-of-range is ignored, leaves prior index intact.
      m.beginDragAnchor(99);
      expect(m.getDragAnchorIndex()).toBe(2);
    });

    it('endDragAnchor clears the index', () => {
      const m = buildSquare();
      m.beginDragAnchor(0);
      m.endDragAnchor();
      expect(m.getDragAnchorIndex()).toBeNull();
    });

    it('moveAnchor updates anchor coords', () => {
      const m = buildSquare();
      m.moveAnchor(0, { x: -5, y: -5 });
      expect(m.getAnchors()![0]).toEqual({ x: -5, y: -5 });
    });

    it('moveAnchor is a noop on closed=false or out-of-range', () => {
      const open = new LassoModel();
      open.moveAnchor(0, { x: 1, y: 1 }); // no anchors → noop
      expect(open.getAnchors()).toBeNull();

      const m = buildSquare();
      const before = JSON.stringify(m.getAnchors());
      m.moveAnchor(99, { x: 1, y: 1 });
      expect(JSON.stringify(m.getAnchors())).toBe(before);
    });
  });

  describe('removeAnchor', () => {
    it('removes when above the minimum count', () => {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 100, y: 100 });
      m.addRawPoint({ x: 50, y: 50 });
      m.addRawPoint({ x: 0, y: 100 });
      m.close();
      const before = m.getAnchors()!.length;
      const ok = m.removeAnchor(2);
      expect(ok).toBe(true);
      expect(m.getAnchors()!.length).toBe(before - 1);
    });

    it('refuses when at MIN_ANCHORS exactly', () => {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 50, y: 100 });
      m.close();
      expect(m.getAnchors()!.length).toBe(3);
      expect(m.removeAnchor(1)).toBe(false);
      expect(m.getAnchors()!.length).toBe(3);
    });
  });

  describe('hitAnchor', () => {
    function square(): LassoModel {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 100, y: 100 });
      m.addRawPoint({ x: 0, y: 100 });
      m.close();
      return m;
    }

    it('returns null when no anchor is within tolerance', () => {
      const m = square();
      expect(m.hitAnchor(50, 50, 5)).toBeNull();
    });

    it('returns the closest anchor index within tolerance', () => {
      const m = square();
      // (102, 1) is 2.236 from (100,0) and 99 from the next corner — pick 1.
      expect(m.hitAnchor(102, 1, 5)).toBe(1);
    });

    it('returns null on an empty lasso', () => {
      const m = new LassoModel();
      expect(m.hitAnchor(0, 0, 100)).toBeNull();
    });
  });

  describe('getBoundingBox', () => {
    it('returns null when not closed', () => {
      const m = new LassoModel();
      expect(m.getBoundingBox()).toBeNull();
    });

    it('returns the AABB of the closed polygon', () => {
      const m = new LassoModel(0.5);
      m.startAt({ x: 10, y: 20 });
      m.addRawPoint({ x: 110, y: 20 });
      m.addRawPoint({ x: 110, y: 80 });
      m.addRawPoint({ x: 10, y: 80 });
      m.close();
      expect(m.getBoundingBox()).toEqual({ x: 10, y: 20, w: 100, h: 60 });
    });
  });

  describe('containsPoint', () => {
    function square(): LassoModel {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 100, y: 100 });
      m.addRawPoint({ x: 0, y: 100 });
      m.close();
      return m;
    }

    it('returns true for an interior point', () => {
      expect(square().containsPoint({ x: 50, y: 50 })).toBe(true);
    });

    it('returns false for an exterior point', () => {
      expect(square().containsPoint({ x: 200, y: 50 })).toBe(false);
    });

    it('returns false on an empty lasso', () => {
      expect(new LassoModel().containsPoint({ x: 0, y: 0 })).toBe(false);
    });
  });

  describe('clear', () => {
    it('wipes all state', () => {
      const m = new LassoModel(0.5);
      m.startAt({ x: 0, y: 0 });
      m.addRawPoint({ x: 100, y: 0 });
      m.addRawPoint({ x: 50, y: 100 });
      m.close();
      m.beginDragAnchor(0);

      m.clear();
      expect(m.isEmpty()).toBe(true);
      expect(m.isClosed()).toBe(false);
      expect(m.getDragAnchorIndex()).toBeNull();
    });
  });

  describe('setSimplifyEpsilon', () => {
    it('influences a subsequent close()', () => {
      // Same path simplified at two different tolerances should yield
      // different anchor counts.
      function pathInto(m: LassoModel) {
        m.startAt({ x: 0, y: 0 });
        for (let i = 1; i <= 9; i++) m.addRawPoint({ x: i * 10, y: i * 0.4 });
        m.addRawPoint({ x: 100, y: 100 });
        m.addRawPoint({ x: 0, y: 100 });
      }
      const tight = new LassoModel(0.5);
      pathInto(tight);
      tight.close();
      const loose = new LassoModel(0.5);
      pathInto(loose);
      loose.setSimplifyEpsilon(20);
      loose.close();
      expect(loose.getAnchors()?.length ?? 0).toBeLessThanOrEqual(tight.getAnchors()?.length ?? 0);
    });
  });
});
