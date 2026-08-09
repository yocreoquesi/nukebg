import type { ImageDataLike } from '../types/image-data-like.js';

export type EncodeFormat = 'png' | 'webp';

/**
 * I/O boundary. Decode bytes into pixels; encode pixels into bytes.
 * Browser implementation uses createImageBitmap+OffscreenCanvas.
 * Node implementation uses sharp.
 */
export interface ImageCodec {
  /**
   * Decode a buffer into RGBA pixels. The codec MAY downscale to
   * `maxDimension` when provided; if it does, it MUST report the
   * original dimensions.
   */
  decode(
    bytes: Uint8Array | ArrayBufferView,
    opts?: { maxDimension?: number },
  ): Promise<{
    image: ImageDataLike;
    originalWidth: number;
    originalHeight: number;
    wasDownsampled: boolean;
  }>;

  encode(
    image: ImageDataLike,
    format: EncodeFormat,
    opts?: { quality?: number },
  ): Promise<Uint8Array>;
}
