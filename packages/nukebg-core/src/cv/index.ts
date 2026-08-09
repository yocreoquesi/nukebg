// CV utility barrel — re-exports pure CV helpers moved from nukebg-app
export { RingBuffer, pixelIndex, maxChannelDiff, mean, std, median } from './utils.js';
export { clamp255 } from './clamp.js';

// Detection algorithms (Phase 6)
export { detectBgColors } from './detect-bg-colors.js';
export { detectCheckerGrid } from './detect-checker-grid.js';
export { extractImageFeatures, classifyImage } from './classify-image.js';
export type { ImageFeatures, ImageContentType } from './classify-image.js';
export { sparkleDetect } from './sparkle-detect.js';
export { watermarkDetect } from './watermark-detect.js';
export { watermarkDetectDalle } from './watermark-dalle.js';

// Inpaint algorithms (Phase 7 — Batch C)
export { inpaintTelea } from './inpaint-telea.js';
export { compositeWithFeather, dilateMask } from './inpaint-blend.js';
export type { FeatherOptions } from './inpaint-blend.js';
export { patchMatchInpaint, patchDistance, initNNF } from './patchmatch-inpaint.js';
export type { PatchMatchOptions } from './patchmatch-inpaint.js';
export { simpleFloodFill } from './simple-flood-fill.js';
export { gridFloodFill } from './grid-flood-fill.js';

// Alpha and matting (Phase 7 — Batch C)
export { guidedFilter } from './alpha-matting.js';
export { alphaRefine } from './alpha-refine.js';
export { estimateForeground } from './foreground-estimation.js';
export type { ForegroundEstimationOptions } from './foreground-estimation.js';
export { shadowCleanup } from './shadow-cleanup.js';
export { signatureThreshold, computeOtsu, morphologicalClose } from './signature-threshold.js';
export { subjectExclusion } from './subject-exclusion.js';

// LaMa crop/router (Phase 7 — Batch C)
export {
  computeLamaCropRect,
  bilinearResizeRGBA,
  nearestResizeMask,
  spliceLamaOutput,
} from './lama-crop.js';
export type { LamaCropRect } from './lama-crop.js';
export { shouldUseLama } from './lama-router.js';
export type { LamaRouterDecision } from './lama-router.js';

// Shared RMBG mask resampler (single source of truth, pixel-center offset)
export { resampleMask } from './resample-mask.js';

// Shared PURE LaMa tensor packing (no onnxruntime import)
export { packRgbaToChw, packMaskToChw, unpackChwToRgba } from './lama-tensors.js';

// RMBG mask refinement chain — single source of truth for both the browser
// worker and the Node runner (see issue #327).
export { refineMask, spatialPass, morphOpen, removeSmallClusters } from './refine-mask.js';
