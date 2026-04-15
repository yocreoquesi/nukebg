/** Supported input formats */
export type SupportedFormat = 'image/png' | 'image/jpeg' | 'image/webp';

/** Supported export formats */
export type ExportFormat = 'png' | 'webp';

/**
 * Legacy constant — retained for backwards compat. Active pipeline uses
 * the capability detector (src/utils/capability-detector.ts) for a
 * device-adaptive bound. This value is only used as a display hint.
 */
export const MAX_DIMENSION = 4096;

/** Validate and load an image file */
export interface ImageLoadResult {
  /**
   * The image used by the pipeline. Equals the original when the image
   * fits the device budget; otherwise a bilinearly-downscaled copy.
   */
  imageData: ImageData;

  /**
   * Original full-resolution pixels, retained for the final composite.
   * Equal to `imageData` when no downscale was applied.
   */
  originalImageData: ImageData;

  originalWidth: number;
  originalHeight: number;
  /** Whether the pipeline copy is smaller than the original */
  wasDownsampled: boolean;
  format: SupportedFormat;
}
