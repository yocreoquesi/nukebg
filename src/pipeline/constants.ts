/** All magic numbers from the Python prototype, centralized */
export const CV_PARAMS = {
  CORNER_SAMPLE_SIZE: 48,
  CHECKER_BRIGHTNESS_STD: 15,
  MIN_GRID_SIZE: 8,
  COLOR_TOLERANCE: 25,
  BOUNDARY_ZONE: 2,
  LOW_COVERAGE_THRESHOLD: 0.30,
  CELL_BG_MATCH_HIGH: 0.65,
  CELL_BG_MATCH_LOW: 0.40,
  CELL_SATURATION_THRESHOLD: 0.20,
  CELL_BRIGHTNESS_THRESHOLD: 50,
  CELL_COLORED_RATIO: 0.15,
  SOLID_BG_VARIANCE: 20,
} as const;

export const WATERMARK_PARAMS = {
  MIN_SCAN_SIZE: 200,
  SCAN_FRACTION: 5,
  THRESHOLD_CASCADE: [30, 20, 15] as const,
  MIN_SPARKLE_PIXELS: 20,
  MAX_SPARKLE_RATIO: 0.05,
  MAX_MEDIAN_DISTANCE_RATIO: 0.4,
  MASK_RADIUS_MULTIPLIER: 1.3,
  HALO_RADIUS_MULTIPLIER: 2.0,
  HALO_DEVIATION_THRESHOLD: 10,
} as const;

export const DALLE_WATERMARK_PARAMS = {
  /** How many rows to scan from the bottom edge */
  SCAN_HEIGHT: 10,
  /** Max scan width from the right edge */
  SCAN_WIDTH: 200,
  /** Min unique colors (quantized) to consider watermark */
  MIN_UNIQUE_COLORS: 15,
  /** Line must have N times more colors than reference */
  CONTRAST_THRESHOLD: 2.0,
  /** Min combined RGB channel spread */
  MIN_CHANNEL_SPREAD: 200,
  /** Extra margin in pixels around detected bar */
  MASK_MARGIN: 2,
} as const;

export const SHADOW_PARAMS = {
  MAX_BLOB_SIZE: 25_000,
  SATURATION_THRESHOLD: 0.15,
  BRIGHTNESS_MAX: 220,
  BRIGHTNESS_MIN: 5,
} as const;

export const ALPHA_PARAMS = {
  MEDIAN_KERNEL: 3,
  GAUSSIAN_SIGMA: 0.8,
  THRESHOLD_HIGH: 200,
  THRESHOLD_LOW: 30,
} as const;

export const GUIDED_FILTER_PARAMS = {
  /** Box filter radius for alpha matting guided filter */
  RADIUS: 15,
  /** Regularization to prevent division by zero in flat regions */
  EPSILON: 1e-4,
} as const;


export const INPAINT_PARAMS = {
  /** Neighbor search radius for Telea FMM.
   *  Must be >= the thickness of the region to reconstruct.
   *  For typical watermarks (sparkle, DALL-E bar) 5-8px is enough. */
  TELEA_RADIUS: 7,
} as const;

export const REFINE_PARAMS = {
  /** Spatial pass radius for edge cleanup */
  SPATIAL_RADIUS: 6,
  /** Absolute minimum cluster size (pixels) */
  MIN_CLUSTER_SIZE: 50,
  /** Relative cluster threshold: remove clusters smaller than this fraction of the main subject */
  CLUSTER_RATIO: 0.01,
  /** Morphological opening radius: erode then dilate to clean orphan edge pixels */
  MORPH_OPEN_RADIUS: 1,
} as const;

export const IMAGE_CLASSIFY_PARAMS = {
  /** Pixel count threshold for sampling unique colors (avoid full scan on large images) */
  SAMPLE_THRESHOLD: 100_000,

  /** Saturation above this is considered "colored" */
  COLORED_SATURATION_THRESHOLD: 0.15,
  /** Brightness above this is considered "near white" */
  NEAR_WHITE_BRIGHTNESS: 200,
  /** Brightness below this is considered "dark" */
  DARK_PIXEL_BRIGHTNESS: 80,

  // SIGNATURE thresholds
  /** Min brightness mean to consider signature */
  SIGNATURE_BRIGHTNESS_MIN: 150,
  /** Max saturation mean for signature (very low color) */
  SIGNATURE_SATURATION_MAX: 0.08,
  /** Min near-white ratio for signature background */
  SIGNATURE_NEAR_WHITE_MIN: 0.50,
  /** Min dark pixel ratio (ink strokes) */
  SIGNATURE_DARK_PIXEL_MIN: 0.01,
  /** Max dark pixel ratio (not too much ink) */
  SIGNATURE_DARK_PIXEL_MAX: 0.40,

  // ICON thresholds
  /** Max total pixels for icon classification */
  ICON_MAX_PIXELS: 250_000,
  /** Max unique colors (quantized) for icon */
  ICON_MAX_UNIQUE_COLORS: 200,
  /** Min aspect ratio for ~square icon */
  ICON_ASPECT_MIN: 0.7,
  /** Max aspect ratio for ~square icon */
  ICON_ASPECT_MAX: 1.43,

  // ILLUSTRATION thresholds
  /** Min unique colors for illustration */
  ILLUSTRATION_UNIQUE_COLORS_MIN: 50,
  /** Max unique colors for illustration */
  ILLUSTRATION_UNIQUE_COLORS_MAX: 800,
  /** Max brightness std for illustration (uniform lighting) */
  ILLUSTRATION_BRIGHTNESS_STD_MAX: 70,

  // ICON RMBG threshold
  /** RMBG confidence threshold for icons (lower = more aggressive) */
  ICON_RMBG_THRESHOLD: 0.3,

  // Signature threshold algorithm params
  /** Min dimension to use Sauvola (below this, fall back to Otsu) */
  SAUVOLA_MIN_SIZE: 200,
  /** Sauvola window size (must be odd) */
  SAUVOLA_WINDOW: 15,
  /** Sauvola sensitivity parameter */
  SAUVOLA_K: 0.2,
  /** Anti-aliasing band width (levels around threshold) */
  AA_BAND_SIZE: 20,
  /** Morphological close radius for filling stroke gaps */
  MORPH_RADIUS: 1,
} as const;
