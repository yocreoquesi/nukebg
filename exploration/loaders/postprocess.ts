/**
 * Postprocessing shared by BiRefNet and RMBG-2.0: sigmoid on logits,
 * bilinear resize back to input dimensions, quantize to Uint8 alpha.
 */

export function sigmoidResizeQuantize(
  logits: Float32Array,
  modelSize: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const maskHiRes = bilinearResizeScalar(logits, modelSize, modelSize, dstW, dstH);
  const alpha = new Uint8Array(dstW * dstH);
  for (let i = 0; i < alpha.length; i++) {
    const p = 1 / (1 + Math.exp(-maskHiRes[i]));
    alpha[i] = Math.max(0, Math.min(255, Math.round(p * 255)));
  }
  return alpha;
}

function bilinearResizeScalar(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return src;
  const dst = new Float32Array(dstW * dstH);
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
      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];
      const top = a + (b - a) * dx;
      const bot = c + (d - c) * dx;
      dst[y * dstW + x] = top + (bot - top) * dy;
    }
  }
  return dst;
}
