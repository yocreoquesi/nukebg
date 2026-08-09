/**
 * Lasso state machine for the advanced editor: tracks the raw freehand
 * path the user is drawing, the simplified anchor polygon once they
 * close it, and any in-flight anchor drag. Pure data + geometry — no
 * DOM, canvas, or pipeline knowledge.
 *
 * Extracted from `ar-editor-advanced.ts` in #47/Phase-3a. The component
 * used to carry four instance fields (`lassoRaw`, `lassoAnchors`,
 * `dragAnchorIndex`, plus the simplification math inline) and call into
 * `simplifyClosed()` directly. Pulling the state into its own class
 * lets the host stay focused on input + render + pipeline wiring, and
 * gives us a place to unit-test the geometry without spinning up a
 * shadow DOM.
 *
 * Reuses `simplifyClosed()` from `../components/lasso-simplify.ts`
 * (pure function, no DOM deps) for Douglas-Peucker reduction.
 */
import { simplifyClosed, type Point } from '../components/lasso-simplify';

export type { Point };

export class LassoModel {
  /** Polygon must have at least this many anchors to be considered
   *  closed. Below this, `close()` discards the path and stays empty. */
  static readonly MIN_ANCHORS = 3;

  /** Default min-distance gate for `addRawPoint()`. Avoids burying the
   *  Douglas-Peucker step in noise from a single user gesture. */
  static readonly DEFAULT_MIN_POINT_DIST = 2;

  private rawPath: Point[] | null = null;
  private anchors: Point[] | null = null;
  private dragIndex: number | null = null;

  constructor(private simplifyEpsilon: number = 1.5) {}

  // ── Read accessors ─────────────────────────────────────────────────

  /** In-progress freehand points, dense and unsimplified. Null while
   *  the lasso is closed or empty. Returned as a defensive shallow copy
   *  is unnecessary — callers should treat it as read-only. */
  getRawPath(): readonly Point[] | null {
    return this.rawPath;
  }

  /** Closed simplified polygon. Null until `close()` succeeds. */
  getAnchors(): readonly Point[] | null {
    return this.anchors;
  }

  /** Index of the anchor currently being dragged, or null. */
  getDragAnchorIndex(): number | null {
    return this.dragIndex;
  }

  isClosed(): boolean {
    return this.anchors !== null && this.anchors.length >= LassoModel.MIN_ANCHORS;
  }

  isEmpty(): boolean {
    return this.rawPath === null && this.anchors === null;
  }

  // ── Mutators ───────────────────────────────────────────────────────

  /** Update the simplification epsilon. Call when the image dimensions
   *  change so the tolerance scales with the canvas. */
  setSimplifyEpsilon(eps: number): void {
    this.simplifyEpsilon = eps;
  }

  /** Begin a fresh raw path. Wipes any prior state including a closed
   *  polygon and any in-progress anchor drag. */
  startAt(point: Point): void {
    this.rawPath = [{ x: point.x, y: point.y }];
    this.anchors = null;
    this.dragIndex = null;
  }

  /** Append a point to the raw path if it sits at least `minDist` away
   *  from the last raw point. Noop when no raw path is active. */
  addRawPoint(point: Point, minDist: number = LassoModel.DEFAULT_MIN_POINT_DIST): void {
    if (!this.rawPath) return;
    const last = this.rawPath[this.rawPath.length - 1];
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx * dx + dy * dy < minDist * minDist) return;
    this.rawPath.push({ x: point.x, y: point.y });
  }

  /** Close the lasso: run Douglas-Peucker on the raw path. If the
   *  resulting polygon has fewer than MIN_ANCHORS vertices, both raw
   *  path and anchors are cleared and 0 is returned. Otherwise the
   *  raw path is dropped and the simplified polygon becomes the
   *  active anchor set; returns the anchor count. */
  close(): number {
    if (!this.rawPath) return 0;
    const simplified = simplifyClosed(this.rawPath, this.simplifyEpsilon);
    this.rawPath = null;
    if (simplified.length < LassoModel.MIN_ANCHORS) {
      this.anchors = null;
      return 0;
    }
    this.anchors = simplified;
    return simplified.length;
  }

  /** Move the anchor at index `idx` to a new position. Noop if the
   *  lasso isn't closed or `idx` is out of bounds. */
  moveAnchor(idx: number, point: Point): void {
    if (!this.anchors) return;
    if (idx < 0 || idx >= this.anchors.length) return;
    this.anchors[idx] = { x: point.x, y: point.y };
  }

  /** Mark `idx` as the anchor being dragged. Caller should subsequently
   *  call `moveAnchor()` on each pointer-move and `endDragAnchor()` on
   *  pointer-up. */
  beginDragAnchor(idx: number): void {
    if (!this.anchors) return;
    if (idx < 0 || idx >= this.anchors.length) return;
    this.dragIndex = idx;
  }

  /** Clear any drag state. Idempotent. */
  endDragAnchor(): void {
    this.dragIndex = null;
  }

  /** Remove the anchor at `idx`. Refuses to delete if it would leave
   *  fewer than MIN_ANCHORS — caller should check `isClosed()` after
   *  to know whether the polygon survived. Returns true if removed. */
  removeAnchor(idx: number): boolean {
    if (!this.anchors) return false;
    if (idx < 0 || idx >= this.anchors.length) return false;
    if (this.anchors.length <= LassoModel.MIN_ANCHORS) return false;
    this.anchors.splice(idx, 1);
    return true;
  }

  /** Wipe all lasso state. Equivalent to "user pressed Esc" or
   *  "controller decided the selection is no longer relevant". */
  clear(): void {
    this.rawPath = null;
    this.anchors = null;
    this.dragIndex = null;
  }

  // ── Geometry queries ───────────────────────────────────────────────

  /** Find the anchor closest to (ix, iy), within `tolerance` pixels.
   *  Returns the index, or null if no anchor is in range. */
  hitAnchor(ix: number, iy: number, tolerance: number): number | null {
    if (!this.anchors) return null;
    const tolSq = tolerance * tolerance;
    let closest = -1;
    let closestDistSq = Infinity;
    for (let i = 0; i < this.anchors.length; i++) {
      const dx = this.anchors[i].x - ix;
      const dy = this.anchors[i].y - iy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= tolSq && distSq < closestDistSq) {
        closest = i;
        closestDistSq = distSq;
      }
    }
    return closest >= 0 ? closest : null;
  }

  /** Axis-aligned bounding box of the closed polygon, in image pixels.
   *  Null if the lasso isn't closed. */
  getBoundingBox(): { x: number; y: number; w: number; h: number } | null {
    if (!this.anchors || this.anchors.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.anchors) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Even-odd ray-casting point-in-polygon test. Returns false if the
   *  lasso isn't closed. */
  containsPoint(p: Point): boolean {
    const poly = this.anchors;
    if (!poly || poly.length < LassoModel.MIN_ANCHORS) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
