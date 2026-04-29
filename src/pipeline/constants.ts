/** All magic numbers from the Python prototype, centralized */
export const CV_PARAMS = {
  CORNER_SAMPLE_SIZE: 48,
  CHECKER_BRIGHTNESS_STD: 15,
  MIN_GRID_SIZE: 8,
  COLOR_TOLERANCE: 25,
  BOUNDARY_ZONE: 2,
  LOW_COVERAGE_THRESHOLD: 0.3,
  CELL_BG_MATCH_HIGH: 0.65,
  CELL_BG_MATCH_LOW: 0.4,
  CELL_SATURATION_THRESHOLD: 0.2,
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

/** Shape-based Gemini sparkle detector — works on real photos where the
 *  color-deviation detector fails (subject covers the bg-color reference). */
export const SPARKLE_PARAMS = {
  /** Fraction of width/height to scan. Gemini always places the sparkle in
   *  the bottom-right; keep this tight to reject distant features. */
  SCAN_WIDTH_FRACTION: 0.2,
  SCAN_HEIGHT_FRACTION: 0.25,
  /** Candidate sparkle radii (pixels). Multi-scale sweep. */
  SCALE_RADII: [10, 14, 20, 28, 40, 55] as const,
  /** Candidate radius must be within this fraction range of min(width, height).
   *  Gemini sparkles render at ~2-4% of the shorter side. */
  MIN_RELATIVE_RADIUS: 0.015,
  MAX_RELATIVE_RADIUS: 0.055,
  /** Stride for the candidate sweep (pixels). Lower = slower but more accurate. */
  CANDIDATE_STRIDE: 2,
  /** Minimum starness score to consider a sparkle detected. */
  MIN_STARNESS: 900,
  /** Every cardinal arm must exceed every diagonal gap by at least this margin.
   *  Higher = stricter concavity requirement. */
  MIN_ARM_GAP_DELTA: 25,
  /** Coefficient of variation cap for cardinals (4-fold rotational symmetry). */
  MAX_ARM_CV: 0.18,
  /** Center luminance must be at least this fraction of mean(cardinals). */
  CENTER_PEAK_RATIO: 0.92,
  /** Center luminance must exceed mean outer ring by this margin. */
  MIN_CENTER_CONTRAST: 25,
  /** Arm-isolation gate: the brightest pixel perpendicular to any arm (sampled
   *  at ±0.35r offset from the arm midpoint) must be darker than the arm mean
   *  by this ratio. Rejects SOLID shapes (nukebg trefoil, motorcycle rotors,
   *  text characters) whose "arms" are actually wide blades with bright
   *  neighbors. Real Gemini sparkle arms are narrow lines — perpendicular
   *  samples land in dark gap territory. */
  MAX_PERP_ARM_RATIO: 0.8,
  /** Core mask radius multiplier (applied to detected sparkle radius).
   *  Tight by design — the actual ✦ shape is fully covered well within
   *  this radius. The natural near-white halo is masked separately by
   *  the palette-gated outer ring (HALO_RADIUS_MULTIPLIER) so this can
   *  stay snug and avoid the "flat patch" artifact on uniform regions. */
  MASK_RADIUS_MULTIPLIER: 1.2,
  /** Outer halo radius multiplier. Pixels between MASK_RADIUS_MULTIPLIER
   *  and this radius are added to the mask ONLY if they match the Gemini
   *  sparkle palette (near-white / slight cyan tint). Ports the legacy
   *  watermark-detect halo-expansion behavior into the shape detector
   *  without reintroducing its false-positive surface (#223). Fixes the
   *  transparent-dot regression on selfies where the natural halo bled
   *  into RMBG's background classification. */
  HALO_RADIUS_MULTIPLIER: 2.0,
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

/**
 * Post-upsample alpha edge refinement params. After the working-res alpha
 * is bilinear-upsampled to original resolution, the edge sits inside a
 * ~4-8 px soft band that is not aligned with the real RGB gradient. A
 * tight guided filter at original resolution, driven by the original
 * luminance, snaps that soft band to the image edge so finalize.ts's
 * quintic sharpen lands on the correct pixel.
 *
 * Only applied when a downscale actually occurred (working res < original).
 * The filter is restricted to the trimap band: pixels at α ≤ BAND_LO or
 * α ≥ BAND_HI are passed through verbatim so pure background and pure body
 * never drift.
 */
export const EDGE_REFINE_PARAMS = {
  /** Box filter radius in ORIGINAL-res pixels. Small on purpose: we want
   *  local edge snap, not smoothing. 4 px is enough to bridge the
   *  bilinear-upsample residual band without washing hair/fur detail. */
  RADIUS: 4,
  /** Regularization — small value = stronger structure transfer from the
   *  guide (snap the alpha edge to RGB gradient). Higher = more smoothing. */
  EPSILON: 1e-3,
  /** Pixels with α ≤ this are kept verbatim (true background). */
  BAND_LO: 10,
  /** Pixels with α ≥ this are kept verbatim (true foreground body). */
  BAND_HI: 245,
} as const;

export const PATCHMATCH_PARAMS = {
  /** Patch radius (pixels). 3 → 7×7 patches, the Barnes 2009 sweet-spot
   *  for texture reconstruction on natural photos. */
  PATCH_RADIUS: 3,
  /** Number of propagation + random-search + voting iterations.
   *  4-5 is enough on masks under ~150 px; more only helps pathological
   *  textures. Each iteration is ~linear in masked-pixel count. */
  ITERATIONS: 5,
} as const;

export const INPAINT_PARAMS = {
  /** Neighbor search radius for Telea FMM.
   *  Must be >= the thickness of the region to reconstruct.
   *  For typical watermarks (sparkle, DALL-E bar) 5-8px is enough. */
  TELEA_RADIUS: 7,
  /** Dilation radius applied to the detected mask BEFORE inpainting. The
   *  extra ring becomes the feather transition zone — Telea fills it with
   *  the same texture flow as the core, and the compositor blends it back
   *  into the original photo. */
  FEATHER_RADIUS: 4,
  /** Std-dev (in 0-255 luminance units) of per-channel Gaussian noise added
   *  inside the inpainted core to restore film grain the inpaint erases.
   *  Values ~4-8 match typical JPEG/camera noise; set to 0 to disable. */
  NOISE_SIGMA: 6,
} as const;

/** LaMa INT8 ONNX model for content-aware watermark reconstruction.
 *  Source: opencv/inpainting_lama on HuggingFace, Apache 2.0 licensed.
 *  Unlike PatchMatch (patch-based), LaMa uses Fourier convolutions that
 *  understand structure and semantics, so it reconstructs watermarks
 *  sitting on faces, text, or complex objects without the flat-patch
 *  look. Only loaded when the router says structure is present.
 *
 *  Integrity:
 *  - URL is pinned to a specific repo commit (not `main`) so an upstream
 *    replacement is caught by size + hash checks below.
 *  - EXPECTED_SIZE is the Content-Length served by HF for this revision.
 *  - EXPECTED_SHA256 is the LFS content hash (HF's X-Linked-ETag).
 *    The worker computes SHA-256 of the downloaded bytes and refuses
 *    to hand them to ORT if it diverges.
 *  Audit date: 2026-04-24. Refresh with:
 *    curl -sSLI "https://huggingface.co/opencv/inpainting_lama/resolve/<sha>/inpainting_lama_2025jan.onnx"
 */
export const LAMA_PARAMS = {
  MODEL_URL:
    'https://huggingface.co/opencv/inpainting_lama/resolve/aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f/inpainting_lama_2025jan.onnx',
  EXPECTED_SIZE: 92_591_623,
  EXPECTED_SHA256: '7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2',
  /** Fixed 1:1 input expected by the ONNX graph. Changing this breaks
   *  inference — it's baked into the Fourier convolution tensor sizes. */
  INPUT_SIZE: 512,
  /** Named input tensors in the exported ONNX model. */
  IMAGE_INPUT_NAME: 'image',
  MASK_INPUT_NAME: 'mask',
  /** Pixels of surrounding context (in original-image scale) added
   *  around the mask bbox before cropping. The Fourier convs need
   *  enough signal around the hole to produce a coherent fill — too
   *  tight and the reconstruction looks flat. */
  CROP_PADDING: 48,
  /** Minimum square side (in original-image scale) the crop expands
   *  to if the mask bbox is tiny. Prevents degenerate 20×20 crops
   *  that blow up to 512 and produce mush. */
  MIN_CROP_SIDE: 128,
  /** Feather radius used when compositing the inpainted region back
   *  into the untouched image. Must be ≥ INPAINT_PARAMS.FEATHER_RADIUS
   *  so the LaMa-reconstructed core blends as softly as PatchMatch. */
  COMPOSITE_FEATHER: 6,
} as const;

/** Heuristic that decides whether a detected watermark lives over
 *  structured content (→ LaMa) or uniform background (→ PatchMatch).
 *  Tuned against real photos with Gemini sparkles / DALL-E bars. */
export const LAMA_ROUTER_PARAMS = {
  /** Luminance variance over the mask-bbox sample. Above this → content
   *  has texture/gradient worth reconstructing with the model. Uniform
   *  sky/wall typically sits around 50-150. */
  VARIANCE_THRESHOLD: 350,
  /** Mean Sobel gradient magnitude over the sample. Above this → edges
   *  are present (object outlines, text, rivets). Flat zones score near 0. */
  EDGE_DENSITY_THRESHOLD: 20,
  /** Pixels added around the raw mask bbox when sampling the heuristic.
   *  Guards against masks too tight to carry signal about what lies
   *  underneath. */
  SAMPLE_BBOX_MARGIN: 12,
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

/** Precision mode type - maps to slider positions */
export type PrecisionMode = 'low-power' | 'normal' | 'high-power' | 'full-nuke';

/** Per-mode pipeline parameters that control processing quality */
export interface PrecisionProfile {
  /** RMBG confidence threshold (lower = keeps more of the subject) */
  rmbgThreshold: number;
  /** Number of spatial refinement passes */
  spatialPasses: number;
  /** Radius for each spatial pass */
  spatialRadius: number;
  /** Morphological opening radius (0 = skip) */
  morphOpenRadius: number;
  /** Relative cluster threshold */
  clusterRatio: number;
  /** Absolute minimum cluster size */
  minClusterSize: number;
}

export const PRECISION_PROFILES: Record<PrecisionMode, PrecisionProfile> = {
  'low-power': {
    rmbgThreshold: 0.6,
    spatialPasses: 1,
    spatialRadius: 4,
    morphOpenRadius: 0,
    clusterRatio: 0.02,
    minClusterSize: 100,
  },
  normal: {
    rmbgThreshold: 0.5,
    spatialPasses: 1,
    spatialRadius: REFINE_PARAMS.SPATIAL_RADIUS,
    morphOpenRadius: REFINE_PARAMS.MORPH_OPEN_RADIUS,
    clusterRatio: REFINE_PARAMS.CLUSTER_RATIO,
    minClusterSize: REFINE_PARAMS.MIN_CLUSTER_SIZE,
  },
  'high-power': {
    rmbgThreshold: 0.4,
    spatialPasses: 2,
    spatialRadius: 5,
    morphOpenRadius: 1,
    clusterRatio: 0.005,
    minClusterSize: 30,
  },
  'full-nuke': {
    rmbgThreshold: 0.3,
    spatialPasses: 3,
    spatialRadius: 4,
    morphOpenRadius: 2,
    clusterRatio: 0.003,
    minClusterSize: 20,
  },
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
  SIGNATURE_NEAR_WHITE_MIN: 0.5,
  /** Min dark pixel ratio (ink strokes) */
  SIGNATURE_DARK_PIXEL_MIN: 0.01,
  /** Max dark pixel ratio (not too much ink) */
  SIGNATURE_DARK_PIXEL_MAX: 0.4,

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

/**
 * MobileSAM — interactive click-to-segment. Encoder runs once per image,
 * decoder runs per click (~300ms). Models from Acly/MobileSAM on HuggingFace
 * (MIT license, compatible with GPL-3.0). Lab-only for now.
 *
 *  Integrity:
 *  - URLs are pinned to a specific repo commit (not `main`) so an upstream
 *    replacement is caught by the SHA-256 checks below.
 *  - The worker computes SHA-256 of the downloaded bytes and refuses
 *    to hand them to ORT if it diverges (mirror of LAMA_PARAMS pattern).
 *  Audit date: 2026-04-26.
 */
export const MOBILESAM_PARAMS = {
  REVISION: '0d3b403339b4674a82493d5e97964dd78089ddc8',
  ENCODER_URL:
    'https://huggingface.co/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/mobile_sam_image_encoder.onnx',
  ENCODER_SIZE: 28_157_093,
  ENCODER_SHA256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749',
  DECODER_URL:
    'https://huggingface.co/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/sam_mask_decoder_single.onnx',
  DECODER_SIZE: 16_501_323,
  DECODER_SHA256: '93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d',
} as const;

/**
 * RMBG-1.4 — primary background-removal model loaded by transformers.js
 * with `dtype: 'q8'`. The library caches the quantized ONNX in the
 * standard browser Cache API ("transformers-cache" by default). After
 * `pipeline()` resolves we re-read that cached blob and SHA-256 it
 * against the audited hash; on mismatch we evict the cache entry and
 * refuse to use the loaded session.
 *
 *  Source: briaai/RMBG-1.4 on HuggingFace (CC-BY-NC-4.0).
 *  Audit date: 2026-04-26.
 */
export const RMBG_PARAMS = {
  REVISION: '2ceba5a5efaec153162aedea169f76caf9b46cf8',
  /** Cache key transformers.js uses (full URL of the file it fetched). */
  MODEL_URL:
    'https://huggingface.co/briaai/RMBG-1.4/resolve/2ceba5a5efaec153162aedea169f76caf9b46cf8/onnx/model_quantized.onnx',
  EXPECTED_SIZE: 44_403_226,
  EXPECTED_SHA256: 'a6648479275dfd0ede0f3a8abc20aa5c437b394681b05e5af6d268250aaf40f3',
  /** Cache name used by @huggingface/transformers v3 in the browser. */
  CACHE_NAME: 'transformers-cache',
} as const;
