/**
 * Canvas painting for the advanced editor's brush and eraser.
 *
 * Extracted from `ar-editor-advanced.ts` in #255. The component read five
 * pieces of its own state inside `applyStrokeSegment` — tool, shape, radius,
 * working canvas, original backing — and the extraction turns those implicit
 * reads into an explicit signature. That is the point of the move, more than
 * the line count: what a stroke depends on is now readable without tracing
 * `this` through a 1700-line component.
 *
 * NOT to be confused with `brush-stroke.ts` in this same directory, despite
 * the names. That one is a value type that walks an ImageData buffer with
 * nested pixel loops, extracted from the since-deleted `ar-editor.ts`; it has
 * no callers and is proposed for deletion in #392. This one issues canvas 2D
 * operations. Same idea, different mechanism, no shared code.
 *
 * The drawing behaviour here is pinned by
 * `tests/components/ar-editor-advanced-drawing.test.ts` (#387), which records
 * the ordered sequence of context calls a stroke produces. Those tests were
 * written against the pre-extraction component and must keep passing
 * unedited — if a change here needs one of them rewritten, that is a
 * behaviour change wearing a refactor's clothes.
 */

/** Tools that paint. The editor's `lasso` reaches none of this. */
export type PaintTool = 'brush' | 'eraser';

export type StrokeShape = 'circle' | 'square';

export interface StrokeOptions {
  /** Anything other than 'brush' or 'eraser' paints nothing. */
  tool: PaintTool | string;
  shape: StrokeShape;
  /** Radius in image pixels. The caller is responsible for clamping it. */
  radius: number;
  /**
   * Source the brush repaints from — the pre-edit image. Null means the brush
   * has nothing to restore and does nothing; the eraser never reads it.
   */
  backing: CanvasImageSource | null;
}

/**
 * Walk a segment in steps small enough that consecutive stamps overlap,
 * calling `stamp` at each centre. Shared by the brush and the square eraser
 * so both trace the same path density; a single click yields one stamp
 * rather than nothing.
 *
 * Note the stamp *positions* are `from + delta * (i / steps)`, so the step
 * size decides how many stamps there are, not how far apart they land. That
 * distinction matters when testing this: a change to the 0.4 factor is
 * invisible at radii where `max(1, …)` floors it, and at distances where
 * both factors round to the same `steps`. See the note in the drawing tests.
 */
export function stampAlong(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  r: number,
  stamp: (cx: number, cy: number) => void,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, r * 0.4);
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= steps; i++) {
    const tfrac = i / steps;
    stamp(fromX + dx * tfrac, fromY + dy * tfrac);
  }
}

/**
 * Paint one segment of a stroke onto `ctx`.
 *
 * The eraser punches alpha out with `destination-out`; the brush clips to the
 * stamp footprint and repaints from `backing`, which is what makes it an undo
 * of the erase rather than a paint in some colour.
 */
export function paintStrokeSegment(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts: StrokeOptions,
): void {
  const r = opts.radius;
  const square = opts.shape === 'square';

  if (opts.tool === 'eraser') {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    if (square) {
      // A stroked line is only `2r` wide perpendicular to motion, so on
      // a diagonal drag it erases a narrower band than the square
      // cursor promises. Stamping axis-aligned squares along the
      // segment gives the true swept footprint, and covers the
      // single-click case for free. Same stepping the brush uses.
      stampAlong(fromX, fromY, toX, toY, r, (cx, cy) => ctx.fillRect(cx - r, cy - r, r * 2, r * 2));
    } else {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (opts.tool !== 'brush' || !opts.backing) return;
  const backing = opts.backing;
  stampAlong(fromX, fromY, toX, toY, r, (cx, cy) => {
    ctx.save();
    ctx.beginPath();
    if (square) {
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.drawImage(backing, 0, 0);
    ctx.restore();
  });
}
