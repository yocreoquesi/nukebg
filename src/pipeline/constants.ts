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
  /** Cuantas filas desde abajo escanear */
  SCAN_HEIGHT: 10,
  /** Ancho maximo de escaneo desde el borde derecho */
  SCAN_WIDTH: 200,
  /** Minimo de colores unicos (cuantizados) para considerar watermark */
  MIN_UNIQUE_COLORS: 15,
  /** La linea debe tener N veces mas colores que la referencia */
  CONTRAST_THRESHOLD: 2.0,
  /** Spread minimo sumado de canales RGB */
  MIN_CHANNEL_SPREAD: 200,
  /** Margen extra en pixeles alrededor de la barra detectada */
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

export const INPAINT_PARAMS = {
  /** Radio de busqueda de vecinos para Telea FMM.
   *  Debe ser >= al grosor de la zona a reconstruir.
   *  Para watermarks tipicos (sparkle, barra DALL-E) 5-8px basta. */
  TELEA_RADIUS: 7,
} as const;
