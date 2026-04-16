import { describe, it, expect } from 'vitest';
import { simplifyClosed, type Point } from '../src/components/lasso-simplify';

function circlePath(cx: number, cy: number, r: number, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

describe('simplifyClosed', () => {
  it('returns input when point count is below 3', () => {
    expect(simplifyClosed([], 5)).toEqual([]);
    expect(simplifyClosed([{ x: 0, y: 0 }], 5)).toEqual([{ x: 0, y: 0 }]);
  });

  it('reduces a redundant straight edge to two endpoints', () => {
    // A triangle sampled at high density along each edge.
    const dense: Point[] = [];
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c];
      const b = corners[(c + 1) % corners.length];
      for (let t = 0; t < 1; t += 0.02) {
        dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    const simplified = simplifyClosed(dense, 1);
    expect(simplified.length).toBeLessThanOrEqual(6);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps enough anchors to represent a circle within epsilon', () => {
    const circle = circlePath(200, 200, 100, 400);
    const simplified = simplifyClosed(circle, 2);
    // Well-known DP-on-circle bound: O(1/sqrt(eps)); at eps=2 over r=100
    // we expect well below 80 anchors but at least a dozen.
    expect(simplified.length).toBeGreaterThanOrEqual(12);
    expect(simplified.length).toBeLessThanOrEqual(80);
  });

  it('never duplicates the seam vertex', () => {
    const pts = circlePath(0, 0, 50, 200);
    const simplified = simplifyClosed(pts, 1);
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    expect(first.x === last.x && first.y === last.y).toBe(false);
  });
});
