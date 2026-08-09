/**
 * PatchMatch inpainting — thin wrapper with PATCHMATCH_PARAMS defaults.
 *
 * The pure algorithm lives in `cv/patchmatch-inpaint.ts` and accepts
 * explicit options. This module provides the four-argument signature used
 * by `run-pipeline.ts` and other call sites that want default parameters
 * baked in from PATCHMATCH_PARAMS.
 *
 * The worker shell (`inpaint.worker.ts`) still imports from this module
 * so both paths go through the same defaults.
 */
import {
  patchMatchInpaint as _patchMatchInpaint,
  type PatchMatchOptions,
} from '../cv/patchmatch-inpaint.js';
import { PATCHMATCH_PARAMS } from '../pipeline/constants.js';

export type { PatchMatchOptions };

/**
 * Inpaint the `mask` region of `src` using PatchMatch with default
 * parameters from PATCHMATCH_PARAMS. Accepts an optional opts override
 * to allow callers to tune iterations, patchRadius, or seed.
 *
 * @param src    RGBA pixel buffer (Uint8ClampedArray)
 * @param width  Image width
 * @param height Image height
 * @param mask   Binary mask (1 = pixel to inpaint, 0 = known pixel)
 * @param opts   Optional override (defaults from PATCHMATCH_PARAMS)
 * @returns New Uint8ClampedArray with masked pixels filled in
 */
export function patchMatchInpaint(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  opts?: Partial<PatchMatchOptions>,
): Uint8ClampedArray {
  return _patchMatchInpaint(src, width, height, mask, {
    iterations: PATCHMATCH_PARAMS.ITERATIONS,
    patchRadius: PATCHMATCH_PARAMS.PATCH_RADIUS,
    ...opts,
  });
}
