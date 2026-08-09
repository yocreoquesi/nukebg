/**
 * Douglas-Peucker polyline simplification, closed-loop variant.
 *
 * Used by the advanced editor lasso: a dense freehand path captured during
 * pointermove is reduced to a small set of anchor points the user can drag.
 *
 * For a closed polygon we virtually append the first point to the end of
 * the open path, simplify, then drop the duplicate terminator so the
 * returned array is the polygon's unique vertices.
 */

export interface Point {
  x: number;
  y: number;
}

function perpDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  // Project p onto segment ab (clamped [0..1])
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return ex * ex + ey * ey;
}

function simplifyOpen(points: Point[], epsSq: number): Point[] {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = points[i];
    const b = points[j];
    for (let k = i + 1; k < j; k++) {
      const d = perpDistanceSq(points[k], a, b);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > epsSq && idx > -1) {
      keep[idx] = 1;
      stack.push([i, idx]);
      stack.push([idx, j]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Simplify a freehand loop. Auto-closes the path before running
 * Douglas-Peucker so the seam is treated like any other edge, then returns
 * the unique polygon vertices (first != last).
 *
 * `epsilon` is in the same units as the input points (image pixels).
 */
export function simplifyClosed(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const closed = points.slice();
  closed.push(points[0]);
  const simplified = simplifyOpen(closed, epsilon * epsilon);
  // Drop the duplicated closing point if present.
  if (
    simplified.length > 1 &&
    simplified[0].x === simplified[simplified.length - 1].x &&
    simplified[0].y === simplified[simplified.length - 1].y
  ) {
    simplified.pop();
  }
  return simplified;
}
