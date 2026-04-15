/**
 * Image preprocessing shared by BiRefNet and RMBG-2.0.
 * Both expect NCHW float tensors at 1024x1024 with ImageNet normalization.
 */

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export interface PreprocessOutput {
  tensor: Float32Array;
  targetSize: number;
}

/**
 * Resize RGBA pixels to (size×size) via bilinear interpolation, normalize,
 * and pack to NCHW Float32 ready for ort.Tensor('float32', ..., [1, 3, size, size]).
 */
export function preprocessImageNet(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  size = 1024,
): PreprocessOutput {
  const resized = bilinearResizeRGB(pixels, width, height, size, size);
  const tensor = new Float32Array(3 * size * size);
  const plane = size * size;

  for (let i = 0; i < plane; i++) {
    const px = i * 4;
    tensor[i] = (resized[px] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    tensor[i + plane] = (resized[px + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    tensor[i + 2 * plane] = (resized[px + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  return { tensor, targetSize: size };
}

function bilinearResizeRGB(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = srcW > 1 ? (srcW - 1) / (dstW - 1 || 1) : 0;
  const yRatio = srcH > 1 ? (srcH - 1) / (dstH - 1 || 1) : 0;

  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const dy = sy - y0;

    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const dx = sx - x0;

      const dstIdx = (y * dstW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = src[(y0 * srcW + x0) * 4 + ch];
        const b = src[(y0 * srcW + x1) * 4 + ch];
        const c = src[(y1 * srcW + x0) * 4 + ch];
        const d = src[(y1 * srcW + x1) * 4 + ch];
        const top = a + (b - a) * dx;
        const bot = c + (d - c) * dx;
        dst[dstIdx + ch] = Math.round(top + (bot - top) * dy);
      }
      dst[dstIdx + 3] = 255;
    }
  }
  return dst;
}
