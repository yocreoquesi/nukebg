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
