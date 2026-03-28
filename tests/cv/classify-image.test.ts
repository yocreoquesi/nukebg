import { describe, it, expect } from 'vitest';
import { extractImageFeatures, classifyImage } from '../../src/workers/cv/classify-image';
import { solidImage, paintRect } from '../helpers';

describe('extractImageFeatures', () => {
  it('extracts correct features from a white image', () => {
    const pixels = solidImage(100, 100, 255, 255, 255);
    const features = extractImageFeatures(pixels, 100, 100);

    expect(features.brightnessMean).toBeGreaterThan(250);
    expect(features.brightnessStd).toBeLessThan(1);
    expect(features.saturationMean).toBeLessThan(0.01);
    expect(features.nearWhiteRatio).toBeGreaterThan(0.99);
    expect(features.darkPixelRatio).toBe(0);
    expect(features.totalPixels).toBe(10000);
    expect(features.aspectRatio).toBe(1);
  });

  it('extracts correct features from a colorful image', () => {
    const w = 200, h = 200;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // Fill with varied colors (gradient)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = Math.floor((x / w) * 255);
        pixels[i + 1] = Math.floor((y / h) * 255);
        pixels[i + 2] = 128;
        pixels[i + 3] = 255;
      }
    }
    const features = extractImageFeatures(pixels, w, h);

    expect(features.uniqueColors).toBeGreaterThan(500);
    expect(features.brightnessStd).toBeGreaterThan(30);
    expect(features.totalPixels).toBe(40000);
  });
});

describe('classifyImage', () => {
  it('classifies mostly white image with dark strokes as SIGNATURE', () => {
    const w = 300, h = 150;
    // White background
    const pixels = solidImage(w, h, 255, 255, 255);
    // Draw a thin dark "signature" line across the middle
    for (let x = 20; x < 280; x++) {
      const y = 75 + Math.floor(Math.sin(x / 10) * 5);
      for (let dy = -1; dy <= 1; dy++) {
        const py = Math.max(0, Math.min(h - 1, y + dy));
        const i = (py * w + x) * 4;
        pixels[i] = 20;
        pixels[i + 1] = 20;
        pixels[i + 2] = 20;
      }
    }

    const features = extractImageFeatures(pixels, w, h);
    const result = classifyImage(features);

    expect(result).toBe('SIGNATURE');
    expect(features.brightnessMean).toBeGreaterThan(150);
    expect(features.saturationMean).toBeLessThan(0.08);
    expect(features.nearWhiteRatio).toBeGreaterThan(0.50);
    expect(features.darkPixelRatio).toBeGreaterThan(0.01);
    expect(features.darkPixelRatio).toBeLessThan(0.40);
  });

  it('classifies colorful varied image as PHOTO', () => {
    const w = 400, h = 300;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // Rich photo-like content with many colors
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = (x * 7 + y * 3) % 256;
        pixels[i + 1] = (x * 3 + y * 7) % 256;
        pixels[i + 2] = (x * 5 + y * 5) % 256;
        pixels[i + 3] = 255;
      }
    }

    const features = extractImageFeatures(pixels, w, h);
    const result = classifyImage(features);

    expect(result).toBe('PHOTO');
    expect(features.uniqueColors).toBeGreaterThan(800);
  });

  it('classifies small low-color square image as ICON', () => {
    const w = 64, h = 64;
    // Flat color icon with few colors
    const pixels = solidImage(w, h, 50, 120, 200);
    // Add a second color region
    paintRect(pixels, w, 16, 16, 32, 32, 255, 200, 50);
    // Add a third small accent
    paintRect(pixels, w, 24, 24, 16, 16, 255, 255, 255);

    const features = extractImageFeatures(pixels, w, h);
    const result = classifyImage(features);

    expect(result).toBe('ICON');
    expect(features.totalPixels).toBeLessThan(250000);
    expect(features.uniqueColors).toBeLessThan(200);
  });

  it('classifies medium-color low-variance image as ILLUSTRATION', () => {
    const w = 600, h = 400;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // Flat shaded regions with per-pixel variation (illustration-like):
    // many bands with x-based and y-based subtle gradients to produce 50-800 unique quantized colors
    const baseColors = [
      [200, 100, 100],
      [100, 200, 100],
      [100, 100, 200],
      [200, 200, 100],
      [100, 200, 200],
      [180, 120, 160],
      [140, 180, 120],
      [160, 140, 180],
      [120, 160, 140],
      [180, 160, 120],
    ];
    const bandHeight = Math.floor(h / baseColors.length);
    for (let y = 0; y < h; y++) {
      const band = Math.min(Math.floor(y / bandHeight), baseColors.length - 1);
      const [r, g, b] = baseColors[band];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Wider x-shift + y-shift to generate enough unique quantized colors (>50)
        const xShift = Math.floor((x / w) * 40);
        const yShift = Math.floor(((y % bandHeight) / bandHeight) * 20);
        pixels[i] = Math.min(255, r + xShift);
        pixels[i + 1] = Math.min(255, g + yShift);
        pixels[i + 2] = Math.min(255, b + xShift + yShift);
        pixels[i + 3] = 255;
      }
    }

    const features = extractImageFeatures(pixels, w, h);
    const result = classifyImage(features);

    expect(result).toBe('ILLUSTRATION');
    expect(features.uniqueColors).toBeGreaterThanOrEqual(50);
    expect(features.uniqueColors).toBeLessThanOrEqual(800);
    expect(features.brightnessStd).toBeLessThan(70);
  });

  it('defaults to PHOTO for ambiguous images', () => {
    const w = 800, h = 600;
    const pixels = new Uint8ClampedArray(w * h * 4);
    // High variation, many colors, large size
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = (x * 13 + y * 17) % 256;
        pixels[i + 1] = (x * 17 + y * 13) % 256;
        pixels[i + 2] = (x * 11 + y * 19) % 256;
        pixels[i + 3] = 255;
      }
    }

    const features = extractImageFeatures(pixels, w, h);
    const result = classifyImage(features);

    expect(result).toBe('PHOTO');
  });

  it('does not misclassify all-black image as SIGNATURE', () => {
    const pixels = solidImage(200, 200, 0, 0, 0);
    const features = extractImageFeatures(pixels, 200, 200);
    const result = classifyImage(features);

    // All black: brightness too low for SIGNATURE, dark ratio too high
    expect(result).not.toBe('SIGNATURE');
  });
});
