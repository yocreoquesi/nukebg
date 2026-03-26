/** Supported input formats */
export type SupportedFormat = 'image/png' | 'image/jpeg' | 'image/webp';

/** Max dimensions before downsampling */
export const MAX_DIMENSION = 4096;

/** Validate and load an image file */
export interface ImageLoadResult {
  imageData: ImageData;
  originalWidth: number;
  originalHeight: number;
  wasDownsampled: boolean;
  format: SupportedFormat;
}
