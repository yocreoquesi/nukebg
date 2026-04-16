/**
 * Edge refinement for the final cutout: decontaminate foreground RGB, then
 * sharpen the soft alpha tails so the exported image reads clean on any
 * background (white, black, colored).
 *
 * The pipeline produces a soft, continuous alpha from RMBG-1.4 (and manual
 * edits keep that soft band), which is great for natural antialiasing but
 * leaves a visible "ghost" band on white when:
 *   - rgb is still contaminated by the background color (halo of wall/sky),
 *   - α extends a wide gradient so even a decontaminated F renders as a
 *     faint FG-colored feather over many pixels.
 *
 * We fix both in two steps:
 *   1) Decontaminate F per pixel by solving I = αF + (1−α)B under a
 *      smoothness prior (see foreground-estimation.ts).
 *   2) Sharpen α with a quintic smoothstep. Smoothstep preserves the 0 and
 *      255 endpoints, squeezes the soft tails aggressively (α=30 → α≈4,
 *      α=60 → α≈20), and keeps a ~2 px antialiased transition around the
 *      midpoint — studio-quality edge without aliasing.
 */
import { composeAtOriginal } from '../utils/final-composite';

/**
 * Minimal pipeline surface the finalize step depends on. Decouples this
 * module from the Orchestrator class so editor components (which hold the
 * same orchestrator reference) can import this without a circular dep risk.
 */
export interface ForegroundEstimator {
  estimateForeground(
    pixels: Uint8ClampedArray,
    alpha: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8ClampedArray>;
}

/**
 * Apply a quintic smoothstep to an alpha plane: 6n⁵ − 15n⁴ + 10n³.
 * Hermite-style S-curve with zero first and second derivatives at both
 * endpoints, so α=0 stays 0 and α=255 stays 255 (no clipping artifacts).
 * The middle band is sharpened symmetrically.
 */
export function sharpenAlpha(alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a === 0) { out[i] = 0; continue; }
    if (a === 255) { out[i] = 255; continue; }
    const n = a / 255;
    const s = n * n * n * (n * (n * 6 - 15) + 10);
    const v = Math.round(s * 255);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * Refine an already-composed RGBA ImageData: decontaminate RGB (if a
 * pipeline is available to run the worker-side solver) and sharpen α.
 *
 * Returns a fresh ImageData; does not mutate the input.
 */
export async function refineEdges(
  pipeline: ForegroundEstimator | null,
  img: ImageData,
): Promise<ImageData> {
  const w = img.width;
  const h = img.height;
  const n = w * h;

  // Alpha plane we pass TO the solver — its backing buffer gets transferred
  // to the CV worker (and detached on return), so we keep a separate copy
  // for sharpenAlpha to read from after the await.
  const alphaForWorker = new Uint8Array(n);
  for (let i = 0; i < n; i++) alphaForWorker[i] = img.data[i * 4 + 3];
  const alphaForSharpen = new Uint8Array(alphaForWorker);

  let rgba: Uint8ClampedArray;
  if (pipeline) {
    const observed = new Uint8ClampedArray(img.data);
    rgba = await pipeline.estimateForeground(observed, alphaForWorker, w, h);
  } else {
    rgba = new Uint8ClampedArray(img.data);
  }

  const sharp = sharpenAlpha(alphaForSharpen);
  for (let i = 0; i < n; i++) rgba[i * 4 + 3] = sharp[i];

  return new ImageData(new Uint8ClampedArray(rgba), w, h);
}

/**
 * Full-pipeline convenience: compose the final RGBA at original resolution,
 * then run refineEdges on it. Main and batch paths use this; editor commit
 * paths call refineEdges directly on the already-composed editor output.
 */
export async function finalizeComposite(
  pipeline: ForegroundEstimator | null,
  input: Parameters<typeof composeAtOriginal>[0],
): Promise<ImageData> {
  const composed = composeAtOriginal(input);
  return refineEdges(pipeline, composed);
}
