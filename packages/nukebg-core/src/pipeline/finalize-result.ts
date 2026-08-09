import { composeAtOriginal } from './final-composite.js';
import { dropOrphanBlobs, fillSubjectHoles, promoteSpeckleAlpha } from './finalize.js';
import type { ImageDataLike } from '../types/image-data-like.js';
import type { ImageContentType } from '../types/pipeline-result.js';

/**
 * Working-resolution pipeline output needed for final composition.
 *
 * This interface captures only the fields from the app's PipelineResult
 * that finalize-result actually needs. It is structurally compatible with
 * the app's PipelineResult so callers don't need to adapt.
 *
 * Moved from packages/nukebg-app/src/pipeline/finalize-result.ts in Phase 8.
 */
export interface WorkingResult {
  readonly workingPixels: Uint8ClampedArray;
  readonly workingAlpha: Uint8Array;
  readonly workingWidth: number;
  readonly workingHeight: number;
  readonly watermarkMask: Uint8Array | null;
  readonly contentType: ImageContentType;
}

/**
 * Turn a working-resolution `WorkingResult` into the camera-ready
 * `ImageDataLike` callers actually export.
 *
 * The orchestrator emits a working-resolution intermediate (downsampled
 * RGB + soft alpha + optional watermark mask). Two steps separate that
 * from a usable export:
 *
 *   1. `composeAtOriginal` — bilinear-upscales α to the original size,
 *      snaps the soft edge band to the original-resolution RGB gradient,
 *      and writes onto pristine original RGB (with inpainted RGB blended
 *      in the watermark region only).
 *
 *   2. Topology cleanup gated by `contentType`. PHOTO assumes "subject is
 *      one body": orphan blobs go, interior holes get filled, and partial-α
 *      specks inside opaque regions get promoted. SIGNATURE and ICON may
 *      legitimately have multiple components — pass `composed` through.
 */
export function finalizePipelineResult(result: WorkingResult, original: ImageDataLike): ImageDataLike {
  const composed = composeAtOriginal({
    originalRgba: original.data,
    originalWidth: original.width,
    originalHeight: original.height,
    workingRgba: result.workingPixels,
    workingWidth: result.workingWidth,
    workingHeight: result.workingHeight,
    workingAlpha: result.workingAlpha,
    inpaintMask: result.watermarkMask,
  });

  const ct = result.contentType;
  if (ct === 'PHOTO') {
    return promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(composed)));
  }
  return composed;
}
