export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Optional: present when constructed by the browser ImageData constructor. Core never reads it. */
  readonly colorSpace?: 'srgb' | 'display-p3';
}

/** Construct an ImageDataLike from raw pixels. Use this instead of `new ImageData(...)` in core. */
export function createImageDataLike(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageDataLike {
  return { data, width, height };
}
