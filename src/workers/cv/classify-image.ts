import { IMAGE_CLASSIFY_PARAMS } from '../../pipeline/constants';

/** Content type classification for auto-algorithm selection */
export type ImageContentType = 'PHOTO' | 'ILLUSTRATION' | 'SIGNATURE' | 'ICON';

/** Extracted image features used for classification */
export interface ImageFeatures {
  brightnessMean: number;
  brightnessStd: number;
  saturationMean: number;
  coloredPixelRatio: number;
  uniqueColors: number;
  nearWhiteRatio: number;
  darkPixelRatio: number;
  totalPixels: number;
  aspectRatio: number;
}

/**
 * Extract statistical features from raw pixel data.
 * These features drive content type classification.
 */
export function extractImageFeatures(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ImageFeatures {
  const totalPixels = width * height;
  const P = IMAGE_CLASSIFY_PARAMS;

  // Sample pixels for unique color counting (full scan is too slow for large images)
  const sampleStep =
    totalPixels > P.SAMPLE_THRESHOLD ? Math.ceil(totalPixels / P.SAMPLE_THRESHOLD) : 1;

  let brightnessSum = 0;
  let brightnessSqSum = 0;
  let saturationSum = 0;
  let coloredPixels = 0;
  let nearWhitePixels = 0;
  let darkPixels = 0;
  const colorSet = new Set<number>();

  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    const r = pixels[off];
    const g = pixels[off + 1];
    const b = pixels[off + 2];

    // Brightness (luminance approximation)
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    brightnessSum += brightness;
    brightnessSqSum += brightness * brightness;

    // Saturation (HSL-style)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510; // normalized 0-1
    const sat = max === min ? 0 : (max - min) / (255 * (1 - Math.abs(2 * lightness - 1) + 1e-6));
    saturationSum += sat;

    // Colored pixel: saturation above threshold
    if (sat > P.COLORED_SATURATION_THRESHOLD) {
      coloredPixels++;
    }

    // Near-white: brightness above threshold
    if (brightness > P.NEAR_WHITE_BRIGHTNESS) {
      nearWhitePixels++;
    }

    // Dark pixel: brightness below threshold
    if (brightness < P.DARK_PIXEL_BRIGHTNESS) {
      darkPixels++;
    }

    // Unique colors (quantized to 5-bit per channel, sampled)
    if (i % sampleStep === 0) {
      const quantized = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      colorSet.add(quantized);
    }
  }

  const brightnessMean = brightnessSum / totalPixels;
  const brightnessVariance = brightnessSqSum / totalPixels - brightnessMean * brightnessMean;
  const brightnessStd = Math.sqrt(Math.max(0, brightnessVariance));
  const saturationMean = saturationSum / totalPixels;
  const coloredPixelRatio = coloredPixels / totalPixels;
  const nearWhiteRatio = nearWhitePixels / totalPixels;
  const darkPixelRatio = darkPixels / totalPixels;
  const aspectRatio = width / height;

  return {
    brightnessMean,
    brightnessStd,
    saturationMean,
    coloredPixelRatio,
    uniqueColors: colorSet.size,
    nearWhiteRatio,
    darkPixelRatio,
    totalPixels,
    aspectRatio,
  };
}

/**
 * Classify an image based on extracted features.
 * Returns the optimal content type for pipeline routing.
 *
 * Priority order: SIGNATURE > ICON > ILLUSTRATION > PHOTO (default)
 */
export function classifyImage(features: ImageFeatures): ImageContentType {
  const P = IMAGE_CLASSIFY_PARAMS;

  // SIGNATURE: high brightness, low saturation, mostly white with some dark strokes
  if (
    features.brightnessMean > P.SIGNATURE_BRIGHTNESS_MIN &&
    features.saturationMean < P.SIGNATURE_SATURATION_MAX &&
    features.nearWhiteRatio > P.SIGNATURE_NEAR_WHITE_MIN &&
    features.darkPixelRatio >= P.SIGNATURE_DARK_PIXEL_MIN &&
    features.darkPixelRatio <= P.SIGNATURE_DARK_PIXEL_MAX
  ) {
    return 'SIGNATURE';
  }

  // ICON: small image, few colors, roughly square
  if (
    features.totalPixels < P.ICON_MAX_PIXELS &&
    features.uniqueColors < P.ICON_MAX_UNIQUE_COLORS &&
    features.aspectRatio >= P.ICON_ASPECT_MIN &&
    features.aspectRatio <= P.ICON_ASPECT_MAX
  ) {
    return 'ICON';
  }

  // ILLUSTRATION: limited color palette, low brightness variation
  if (
    features.uniqueColors >= P.ILLUSTRATION_UNIQUE_COLORS_MIN &&
    features.uniqueColors <= P.ILLUSTRATION_UNIQUE_COLORS_MAX &&
    features.brightnessStd < P.ILLUSTRATION_BRIGHTNESS_STD_MAX
  ) {
    return 'ILLUSTRATION';
  }

  // Default: PHOTO
  return 'PHOTO';
}
