import type { ImageContentType } from './pipeline-result.js';

/** Result from background color detection */
export interface BgColorResult {
  colorA: number[]; // RGB, 3 values
  colorB: number[]; // RGB, 3 values
  isCheckerboard: boolean;
  cornerVariance: number;
}

/** Result from watermark detection */
export interface WatermarkResult {
  detected: boolean;
  mask: Uint8Array | null;
  centerX?: number;
  centerY?: number;
  radius?: number;
}

/** Result from image classification */
export interface ClassifyImageResult {
  type: ImageContentType;
  confidence: number;
}

/** Extracted image features used for classification */
export interface ImageFeatures {
  edgeDensity: number;
  colorVariance: number;
  centerMass: { x: number; y: number };
  hasTransparency: boolean;
}

/** Result from checker grid detection */
export interface GridResult {
  gridSize: number;
  phase: number;
}
