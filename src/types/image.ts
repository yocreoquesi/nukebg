/** Supported input formats */
export type SupportedFormat = 'image/png' | 'image/jpeg' | 'image/webp';

/** Supported export formats */
export type ExportFormat = 'png' | 'webp';

/** Max dimensions before downsampling (lower on mobile to reduce memory) */
const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
export const MAX_DIMENSION = isMobile ? 2048 : 4096;

/** Validate and load an image file */
export interface ImageLoadResult {
  imageData: ImageData;
  originalWidth: number;
  originalHeight: number;
  wasDownsampled: boolean;
  format: SupportedFormat;
}
