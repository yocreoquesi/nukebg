import { DALLE_WATERMARK_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';
import { pixelIndex } from './utils';

/**
 * Detectar el watermark de DALL-E 3: barra multicolor de ~5px en la
 * esquina inferior derecha. Se busca una linea horizontal con alta
 * variacion de color (muchos colores distintos en pocos pixeles)
 * que no encaje con el resto de la imagen.
 */
export function watermarkDetectDalle(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkResult {
  const scanH = DALLE_WATERMARK_PARAMS.SCAN_HEIGHT;
  const scanW = Math.min(DALLE_WATERMARK_PARAMS.SCAN_WIDTH, Math.floor(width / 3));
  const minUniqueColors = DALLE_WATERMARK_PARAMS.MIN_UNIQUE_COLORS;
  const contrastThreshold = DALLE_WATERMARK_PARAMS.CONTRAST_THRESHOLD;

  // Escanear las ultimas filas, zona derecha
  let barStartY = -1;
  let barEndY = -1;

  for (let y = height - scanH; y < height; y++) {
    // Recoger colores de la linea en la zona derecha
    const colors = new Set<number>();
    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;

    for (let x = width - scanW; x < width; x++) {
      const idx = pixelIndex(x, y, width);
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      // Cuantizar a bloques de 16 para agrupar colores cercanos
      const quantized = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      colors.add(quantized);
      sumR += r;
      sumG += g;
      sumB += b;
      count++;
    }

    if (count === 0) continue;

    // Verificar alta variacion de color
    if (colors.size < minUniqueColors) continue;

    // Comparar con la linea de arriba (referencia del fondo)
    const refY = Math.max(0, y - scanH - 5);
    const refColors = new Set<number>();
    for (let x = width - scanW; x < width; x++) {
      const idx = pixelIndex(x, refY, width);
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const quantized = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      refColors.add(quantized);
    }

    // La linea de watermark debe tener significativamente mas colores que la referencia
    if (colors.size <= refColors.size * contrastThreshold) continue;

    // Verificar que hay variacion real de hue (no solo ruido de brillo)
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (let x = width - scanW; x < width; x++) {
      const idx = pixelIndex(x, y, width);
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minG = Math.min(minG, g); maxG = Math.max(maxG, g);
      minB = Math.min(minB, b); maxB = Math.max(maxB, b);
    }
    const channelSpread = (maxR - minR) + (maxG - minG) + (maxB - minB);
    if (channelSpread < DALLE_WATERMARK_PARAMS.MIN_CHANNEL_SPREAD) continue;

    // Esta linea parece parte del watermark
    if (barStartY === -1) barStartY = y;
    barEndY = y;
  }

  if (barStartY === -1) {
    return { detected: false, mask: null };
  }

  // Construir mascara cubriendo la barra + margen
  const margin = DALLE_WATERMARK_PARAMS.MASK_MARGIN;
  const maskStartY = Math.max(0, barStartY - margin);
  const maskEndY = Math.min(height - 1, barEndY + margin);
  const maskStartX = Math.max(0, width - scanW - margin);
  const maskEndX = width - 1;

  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);

  for (let y = maskStartY; y <= maskEndY; y++) {
    for (let x = maskStartX; x <= maskEndX; x++) {
      mask[y * width + x] = 1;
    }
  }

  const centerX = Math.floor((maskStartX + maskEndX) / 2);
  const centerY = Math.floor((maskStartY + maskEndY) / 2);

  return {
    detected: true,
    mask,
    centerX,
    centerY,
  };
}
