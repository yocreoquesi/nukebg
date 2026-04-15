/**
 * Region-of-interest processing for the lab.
 *
 * Takes a user-drawn freehand polygon + the original image + an injected
 * segmenter and returns a final composited ImageData. Two modes:
 *   - 'crop':   transparent outside the polygon, segmentation inside.
 *   - 'refine': previous alpha outside the polygon, segmentation inside.
 *
 * Pure function on top of:
 *   - rasterizePolygon(): renders the freehand path to a binary mask via
 *     OffscreenCanvas so self-intersections and auto-closing are handled
 *     by the browser's even-odd rasterizer for free.
 *   - segmenter: caller-provided, typically the rmbg-1.4 lab loader. Runs
 *     on a cropped tensor so the subject gets native-resolution detail.
 */

export interface PolygonPoint {
  x: number;
  y: number;
}

export type RoiMode = 'crop' | 'refine';

export interface RoiInput {
  /** Full-resolution input image. */
  original: ImageData;
  /** Freehand path in original-image coordinates. Auto-closed if not already. */
  polygon: PolygonPoint[];
  /** Previous alpha mask (same size as original). Required when mode === 'refine'. */
  previousAlpha: Uint8Array | null;
  /** Output mode. */
  mode: RoiMode;
  /** Segmenter callback: receives a crop and returns its alpha mask at the same size. */
  segment: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<Uint8Array>;
  /** Extra margin around the bbox fed to the segmenter (ratio). Default 0.08 (8%). */
  bboxMarginRatio?: number;
}

export interface RoiOutput {
  imageData: ImageData;
  /** Alpha mask applied to the final image (matches original size). */
  alpha: Uint8Array;
  /** BBox actually fed to the segmenter (pre-expansion). */
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * Rasterize a freehand polygon into a binary mask (1 inside, 0 outside).
 *
 * Scanline fill with even-odd rule — the path closes implicitly (last→first
 * edge is treated like any other) so the user can paint without returning
 * exactly to the start. Pure JS so happy-dom tests work without a canvas.
 */
export function rasterizePolygon(
  polygon: PolygonPoint[],
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const n = polygon.length;
  if (n < 3) return mask;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(height - 1, Math.ceil(maxY));

  for (let y = y0; y <= y1; y++) {
    const yCenter = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const ay = a.y;
      const by = b.y;
      if ((ay <= yCenter && by > yCenter) || (by <= yCenter && ay > yCenter)) {
        const t = (yCenter - ay) / (by - ay);
        crossings.push(a.x + t * (b.x - a.x));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(crossings[i]));
      const x1 = Math.min(width - 1, Math.floor(crossings[i + 1]));
      const row = y * width;
      for (let x = x0; x <= x1; x++) mask[row + x] = 1;
    }
  }
  return mask;
}

function polygonBoundingBox(
  polygon: PolygonPoint[],
  imgWidth: number,
  imgHeight: number,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(imgWidth, Math.ceil(maxX));
  maxY = Math.min(imgHeight, Math.ceil(maxY));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function expandBbox(
  bbox: { x: number; y: number; width: number; height: number },
  marginRatio: number,
  imgWidth: number,
  imgHeight: number,
): { x: number; y: number; width: number; height: number } {
  const mx = Math.round(bbox.width * marginRatio);
  const my = Math.round(bbox.height * marginRatio);
  const x = Math.max(0, bbox.x - mx);
  const y = Math.max(0, bbox.y - my);
  const right = Math.min(imgWidth, bbox.x + bbox.width + mx);
  const bottom = Math.min(imgHeight, bbox.y + bbox.height + my);
  return { x, y, width: right - x, height: bottom - y };
}

function cropRgba(
  src: Uint8ClampedArray,
  srcWidth: number,
  bbox: { x: number; y: number; width: number; height: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bbox.width * bbox.height * 4);
  for (let y = 0; y < bbox.height; y++) {
    const srcRow = (bbox.y + y) * srcWidth * 4 + bbox.x * 4;
    const dstRow = y * bbox.width * 4;
    out.set(src.subarray(srcRow, srcRow + bbox.width * 4), dstRow);
  }
  return out;
}

export async function processRoi(input: RoiInput): Promise<RoiOutput> {
  const { original, polygon, previousAlpha, mode, segment } = input;
  const marginRatio = input.bboxMarginRatio ?? 0.08;

  if (polygon.length < 3) {
    throw new Error('ROI polygon must have at least 3 points');
  }
  if (mode === 'refine' && !previousAlpha) {
    throw new Error('ROI refine mode requires previousAlpha');
  }

  const polyMask = rasterizePolygon(polygon, original.width, original.height);

  const rawBbox = polygonBoundingBox(polygon, original.width, original.height);
  if (rawBbox.width < 8 || rawBbox.height < 8) {
    throw new Error('ROI selection too small');
  }
  const bbox = expandBbox(rawBbox, marginRatio, original.width, original.height);

  const crop = cropRgba(original.data, original.width, bbox);
  const segAlpha = await segment(crop, bbox.width, bbox.height);
  if (segAlpha.length !== bbox.width * bbox.height) {
    throw new Error('Segmenter returned alpha of unexpected size');
  }

  const alpha = new Uint8Array(original.width * original.height);
  if (mode === 'refine' && previousAlpha) alpha.set(previousAlpha);

  for (let y = 0; y < original.height; y++) {
    for (let x = 0; x < original.width; x++) {
      const idx = y * original.width + x;
      if (!polyMask[idx]) {
        if (mode === 'crop') alpha[idx] = 0;
        continue;
      }
      if (x < bbox.x || y < bbox.y || x >= bbox.x + bbox.width || y >= bbox.y + bbox.height) {
        // Inside polygon but outside the expanded bbox — shouldn't happen because
        // bbox is the polygon bbox + margin, but guard anyway.
        alpha[idx] = 0;
        continue;
      }
      const segIdx = (y - bbox.y) * bbox.width + (x - bbox.x);
      alpha[idx] = segAlpha[segIdx];
    }
  }

  const out = new Uint8ClampedArray(original.data.length);
  out.set(original.data);
  for (let i = 0; i < alpha.length; i++) {
    out[i * 4 + 3] = alpha[i];
  }

  return {
    imageData: new ImageData(out, original.width, original.height),
    alpha,
    bbox,
  };
}
