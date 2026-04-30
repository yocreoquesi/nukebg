import type { PipelineResult } from '../types/pipeline';
import { composeAtOriginal } from '../utils/final-composite';
import { dropOrphanBlobs, fillSubjectHoles, promoteSpeckleAlpha } from './finalize';

/**
 * Turn a working-resolution `PipelineResult` into the camera-ready
 * `ImageData` callers actually export.
 *
 * The orchestrator emits a working-resolution intermediate (downsampled
 * RGB + soft alpha + optional watermark mask). Two steps separate that
 * from a usable export:
 *
 *   1. `composeAtOriginal` — bilinear-upscales α to the original size,
 *      snaps the soft edge band to the original-resolution RGB
 *      gradient, and writes onto pristine original RGB (with inpainted
 *      RGB blended in the watermark region only).
 *
 *   2. Topology cleanup gated by `contentType`. PHOTO and ILLUSTRATION
 *      assume "subject is one body": orphan blobs go (RMBG horizon
 *      bands, detached watermark fragments), interior holes get filled
 *      (specular highlights mistaken for background), and partial-α
 *      specks inside opaque regions get promoted. SIGNATURE and ICON
 *      may legitimately have multiple components and interior
 *      antialiasing — pass `composed` through verbatim.
 *
 * Both callers used to do this chain inline; this is the public surface
 * they should depend on now. Editor flows that reprocess pre-composited
 * RGBA (basic editor done, advanced editor done) keep using
 * `refineEdges` directly because they don't have a `PipelineResult`.
 */
export function finalizePipelineResult(result: PipelineResult, original: ImageData): ImageData {
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
  if (ct === 'PHOTO' || ct === 'ILLUSTRATION') {
    return promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(composed)));
  }
  return composed;
}
