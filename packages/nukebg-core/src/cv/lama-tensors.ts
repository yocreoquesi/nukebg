// Shared PURE tensor packing for LaMa — the NCHW plane packing math extracted
// from the browser `lama.worker.ts` (`rgbaToImageTensor`, `maskToTensor`,
// `imageTensorToRgba`). Design §I.2: the pure math lives here; only the
// runtime-specific `new ort.Tensor(...)` wrap stays per-package. This module
// MUST NOT import onnxruntime — callers wrap the returned Float32Array in
// their own `ort.Tensor` (and pass their tensor's `.data` back for unpack).

/**
 * Pack an RGBA image into a NCHW (1x3xHxW) RGB plane layout, normalized /255.
 * Alpha is dropped. Returns the raw Float32Array (length `3 * width * height`).
 */
export function packRgbaToChw(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4] ?? 0) / 255; // R
    out[plane + i] = (data[i * 4 + 1] ?? 0) / 255; // G
    out[2 * plane + i] = (data[i * 4 + 2] ?? 0) / 255; // B
  }
  return out;
}

/**
 * Pack a binary mask (0/non-zero) into a NCHW (1x1xHxW) float plane (0 or 1).
 * Returns the raw Float32Array (length `width * height`).
 */
export function packMaskToChw(
  mask: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const out = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    out[i] = mask[i] ? 1 : 0;
  }
  return out;
}

/**
 * Unpack a NCHW (1x3xHxW) RGB plane back into an RGBA image. The inverse of
 * `packRgbaToChw`: reads the raw model-output data (caller passes the ort
 * tensor's `.data`), writes RGB per pixel and sets alpha to 255. Returns the
 * raw pixels (length `width * height * 4`).
 */
export function unpackChwToRgba(
  chw: Float32Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const plane = width * height;
  const rgba = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    rgba[i * 4] = chw[i] ?? 0; // R
    rgba[i * 4 + 1] = chw[plane + i] ?? 0; // G
    rgba[i * 4 + 2] = chw[2 * plane + i] ?? 0; // B
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
