/**
 * Immutable record of a single brush operation in the basic editor:
 * a circular or square stamp at one image-pixel coordinate, in either
 * 'erase' (zero alpha) or 'restore' (copy RGBA from the pre-segmentation
 * source) mode.
 *
 * Extracted from `ar-editor.ts` in #47/Phase-2. The component used to
 * inline this logic in a private `stamp()` method that mutated
 * `this.imageData` directly. Pulling it out as a value type lets tests
 * exercise the pixel arithmetic without spinning up a custom element,
 * and keeps the component focused on input + canvas wiring.
 *
 * The class intentionally has no DOM / canvas dependencies — only
 * ImageData buffers in and out. That makes it safe to call from a
 * worker if we ever need to replay strokes off the main thread.
 */
export type BrushTool = 'erase' | 'restore';

export type BrushShape = 'circle' | 'square';

export interface BrushStrokeConfig {
  /** Center X in image pixels. */
  cx: number;
  /** Center Y in image pixels. */
  cy: number;
  /** Erase = drop alpha to 0; restore = copy RGBA from `originalImage`. */
  tool: BrushTool;
  /** Diameter in image pixels. Radius is derived as `Math.floor(size / 2)`. */
  size: number;
  /** Footprint shape. Square is bbox; circle clips to (dx² + dy² ≤ r²). */
  shape: BrushShape;
}

export class BrushStroke {
  readonly cx: number;
  readonly cy: number;
  readonly tool: BrushTool;
  readonly size: number;
  readonly shape: BrushShape;

  constructor(config: BrushStrokeConfig) {
    this.cx = config.cx;
    this.cy = config.cy;
    this.tool = config.tool;
    this.size = config.size;
    this.shape = config.shape;
  }

  /**
   * Apply this stroke onto `imageData` (mutating its pixel buffer).
   * The `originalImage` source is only read when the tool is 'restore';
   * 'erase' just zeros out alpha. Both buffers must share `width × height`
   * dimensions; mismatches are caller error.
   *
   * Pixels outside the image bounds are skipped silently — the editor
   * lets the user paint past the canvas edge without errors.
   */
  apply(imageData: ImageData, originalImage: ImageData, width: number, height: number): void {
    const data = imageData.data;
    const src = originalImage.data;
    const restore = this.tool === 'restore';
    const r = Math.floor(this.size / 2);
    const circle = this.shape === 'circle';
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = this.cx + dx;
        const py = this.cy + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        if (circle && dx * dx + dy * dy > r2) continue;
        const i = (py * width + px) * 4;
        if (restore) {
          data[i] = src[i];
          data[i + 1] = src[i + 1];
          data[i + 2] = src[i + 2];
          data[i + 3] = src[i + 3];
        } else {
          data[i + 3] = 0;
        }
      }
    }
  }
}
