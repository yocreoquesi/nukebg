/**
 * Bbox-refine mode: two-pass inference that recovers native-resolution detail
 * on large images without falling into tiling artifacts.
 *
 * Pass 1 — coarse: run the loader on the whole image. Produces a coarse alpha.
 * Pass 2 — fine:   crop the ORIGINAL image to the subject bbox (+ margin),
 *                  run the loader again. Produces a sharp alpha over the crop.
 * Compose:         final alpha = zero outside bbox, fine alpha inside bbox.
 *
 * Why this beats naive tiling for segmentation:
 *   - Tiles without the subject can never "invent" foreground — they're
 *     literally outside the bbox, forced to zero.
 *   - The second pass sees the subject at near-native resolution (the crop
 *     usually down-scales less than the full image did), so fine edges are
 *     preserved.
 *   - Global context is preserved because pass 1 ran on the whole image.
 *
 * Tradeoffs:
 *   - ~2× latency per image.
 *   - No win when the subject already fills the frame (bbox ≈ full image).
 *   - Still bounded by the model's 1024×1024 input — very large subjects
 *     within the crop hit the same downscale ceiling (that's when Phase B,
 *     tiled inference with prior, would kick in; deferred).
 */

import type { ModelLoader, SegmentInput, SegmentOutput } from './loaders/types';

/** Fraction of the subject bbox's longest side to expand on each side. */
const BBOX_MARGIN_RATIO = 0.08;

/** Alpha threshold (0..255) above which a pixel is considered subject for bbox. */
const BBOX_ALPHA_THRESHOLD = 24;

/** If the bbox covers more than this fraction of the image, skip the refine pass. */
const BBOX_SKIP_COVERAGE = 0.92;

export interface BboxRefineOutput extends SegmentOutput {
  /** True when pass 2 actually ran (bbox was a meaningful subset). */
  refined: boolean;
  /** Coarse alpha for comparison; useful for the lab's side-by-side viewer. */
  coarseAlpha: Uint8Array;
  /** The crop used for pass 2, relative to the input image. Null when refine was skipped. */
  bbox: { x: number; y: number; w: number; h: number } | null;
}

export async function segmentWithBboxRefine(
  loader: ModelLoader,
  input: SegmentInput,
): Promise<BboxRefineOutput> {
  const started = performance.now();
  const coarse = await loader.segment(input);
  const coarseAlpha = coarse.alpha;

  const bbox = computeBbox(coarseAlpha, input.width, input.height, BBOX_ALPHA_THRESHOLD);
  if (!bbox) {
    // Model found no subject at all. Return the coarse alpha as-is.
    return {
      ...coarse,
      refined: false,
      coarseAlpha,
      bbox: null,
      latencyMs: performance.now() - started,
    };
  }

  const expanded = expandBbox(bbox, input.width, input.height, BBOX_MARGIN_RATIO);
  const coverage = (expanded.w * expanded.h) / (input.width * input.height);
  if (coverage >= BBOX_SKIP_COVERAGE) {
    // Subject already fills the frame — refine pass would add cost for no gain.
    return {
      ...coarse,
      refined: false,
      coarseAlpha,
      bbox: expanded,
      latencyMs: performance.now() - started,
    };
  }

  const crop = cropRgba(input.pixels, input.width, input.height, expanded);
  const fine = await loader.segment({ pixels: crop, width: expanded.w, height: expanded.h });

  const composed = placeAlphaAtBbox(fine.alpha, expanded, input.width, input.height);

  return {
    alpha: composed,
    width: input.width,
    height: input.height,
    latencyMs: performance.now() - started,
    backend: fine.backend,
    refined: true,
    coarseAlpha,
    bbox: expanded,
  };
}

function computeBbox(
  alpha: Uint8Array,
  w: number,
  h: number,
  threshold: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function expandBbox(
  bbox: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
  ratio: number,
): { x: number; y: number; w: number; h: number } {
  const margin = Math.round(Math.max(bbox.w, bbox.h) * ratio);
  const x = Math.max(0, bbox.x - margin);
  const y = Math.max(0, bbox.y - margin);
  const right = Math.min(imgW, bbox.x + bbox.w + margin);
  const bottom = Math.min(imgH, bbox.y + bbox.h + margin);
  return { x, y, w: right - x, h: bottom - y };
}

function cropRgba(
  src: Uint8ClampedArray,
  srcW: number,
  _srcH: number,
  bbox: { x: number; y: number; w: number; h: number },
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(bbox.w * bbox.h * 4);
  for (let y = 0; y < bbox.h; y++) {
    const srcRow = ((bbox.y + y) * srcW + bbox.x) * 4;
    const dstRow = y * bbox.w * 4;
    dst.set(src.subarray(srcRow, srcRow + bbox.w * 4), dstRow);
  }
  return dst;
}

function placeAlphaAtBbox(
  fine: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
): Uint8Array {
  const out = new Uint8Array(imgW * imgH);
  for (let y = 0; y < bbox.h; y++) {
    const srcRow = y * bbox.w;
    const dstRow = (bbox.y + y) * imgW + bbox.x;
    out.set(fine.subarray(srcRow, srcRow + bbox.w), dstRow);
  }
  return out;
}
