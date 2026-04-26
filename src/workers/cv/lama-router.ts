import { LAMA_ROUTER_PARAMS } from '../../pipeline/constants';

export interface LamaRouterDecision {
  /** True → use LaMa (ONNX, content-aware). False → PatchMatch (CV, instant). */
  useLama: boolean;
  /** Luminance variance of the sample bbox (diagnostic). */
  variance: number;
  /** Mean Sobel magnitude of the sample bbox (diagnostic). */
  edgeDensity: number;
  /** Expanded sample bbox in image coordinates. */
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * Decide whether a watermark should be inpainted with LaMa or PatchMatch.
 *
 * The decision is made on what the watermark sits ON, not on the mask
 * itself. We measure two cheap statistics over the mask's (expanded)
 * bounding box:
 *   - luminance variance   → texture / gradient presence
 *   - mean Sobel magnitude → explicit edges (object outlines, text)
 *
 * Above either threshold the underlying content has structure the
 * model can reason about — LaMa pays off. Below both, PatchMatch over
 * a patch-similarity field is indistinguishable and ~1000× cheaper.
 *
 * Kept as a pure function so the orchestrator can call it directly on
 * the main thread and the unit tests can exercise it without workers.
 */
export function shouldUseLama(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): LamaRouterDecision {
  const bbox = expandedMaskBbox(mask, width, height, LAMA_ROUTER_PARAMS.SAMPLE_BBOX_MARGIN);
  if (!bbox) {
    return {
      useLama: false,
      variance: 0,
      edgeDensity: 0,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  const variance = luminanceVariance(pixels, width, bbox);
  const edgeDensity = sobelMeanMagnitude(pixels, width, bbox);
  const useLama =
    variance > LAMA_ROUTER_PARAMS.VARIANCE_THRESHOLD ||
    edgeDensity > LAMA_ROUTER_PARAMS.EDGE_DENSITY_THRESHOLD;

  return { useLama, variance, edgeDensity, bbox };
}

function expandedMaskBbox(
  mask: Uint8Array,
  width: number,
  height: number,
  margin: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - margin);
  const y0 = Math.max(0, minY - margin);
  const x1 = Math.min(width - 1, maxX + margin);
  const y1 = Math.min(height - 1, maxY + margin);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function luminance(pixels: Uint8ClampedArray, idx: number): number {
  return pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
}

function luminanceVariance(
  pixels: Uint8ClampedArray,
  width: number,
  bbox: { x: number; y: number; w: number; h: number },
): number {
  let sum = 0,
    sumSq = 0,
    n = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    const row = y * width * 4;
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const lum = luminance(pixels, row + x * 4);
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function sobelMeanMagnitude(
  pixels: Uint8ClampedArray,
  width: number,
  bbox: { x: number; y: number; w: number; h: number },
): number {
  if (bbox.w < 3 || bbox.h < 3) return 0;
  let sum = 0,
    n = 0;
  for (let y = bbox.y + 1; y < bbox.y + bbox.h - 1; y++) {
    for (let x = bbox.x + 1; x < bbox.x + bbox.w - 1; x++) {
      const p = (ix: number, iy: number): number => luminance(pixels, (iy * width + ix) * 4);
      const gx =
        -p(x - 1, y - 1) +
        p(x + 1, y - 1) +
        -2 * p(x - 1, y) +
        2 * p(x + 1, y) +
        -p(x - 1, y + 1) +
        p(x + 1, y + 1);
      const gy =
        -p(x - 1, y - 1) -
        2 * p(x, y - 1) -
        p(x + 1, y - 1) +
        p(x - 1, y + 1) +
        2 * p(x, y + 1) +
        p(x + 1, y + 1);
      sum += Math.sqrt(gx * gx + gy * gy);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}
