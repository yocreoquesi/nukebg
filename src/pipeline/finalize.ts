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
 * Narrow-band quintic smoothstep on the RMBG soft-alpha gradient.
 *
 *   α ≤ LOW  → 0          (kills the wide halo tail)
 *   α ≥ HIGH → 255         (tight interior, no feathering into the body)
 *   in-between → 6n⁵−15n⁴+10n³ normalized over [LOW, HIGH]
 *
 * RMBG emits a smooth ~3–5 px transition in alpha-value space (roughly
 * covering [20, 230]). A full-range smoothstep over [0, 255] leaves a
 * 3 px soft band that reads as color halo on flat backgrounds; a pure
 * binary threshold at 128 removes that but exposes 1 px staircase
 * aliasing on curved edges. This narrow band (width 60, centered at 130)
 * covers ~30 % of the gradient, which collapses to roughly 1 output pixel
 * of antialiasing — the same tightness you get from a 1 px feather on a
 * Photoshop selection.
 */
const SHARPEN_LOW = 100;
const SHARPEN_HIGH = 160;

export function sharpenAlpha(alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(alpha.length);
  const range = SHARPEN_HIGH - SHARPEN_LOW;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a <= SHARPEN_LOW) { out[i] = 0; continue; }
    if (a >= SHARPEN_HIGH) { out[i] = 255; continue; }
    const n = (a - SHARPEN_LOW) / range;
    const s = n * n * n * (n * (n * 6 - 15) + 10);
    const v = Math.round(s * 255);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * In-place 8-connected component labelling; keep only the largest
 * component of 1-pixels, zero everything else. Handles the user's
 * "no isolated elements" requirement: if RMBG leaves a detached blob
 * (a piece of crowd, a misfired chunk of watermark), it goes away.
 *
 * Why 8-connectivity: a hair strand or antenna can attach to the body
 * through a diagonal pixel; 4-connectivity would split it off.
 */
export function keepLargestComponent(bin: Uint8Array, w: number, h: number): void {
  const labels = new Int32Array(bin.length);
  const queue = new Int32Array(bin.length);
  const sizes: number[] = [0]; // id 0 is reserved for background

  let nextId = 0;
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 0 || labels[i] !== 0) continue;
    nextId++;
    labels[i] = nextId;
    let head = 0, tail = 0;
    queue[tail++] = i;
    let size = 0;
    while (head < tail) {
      const idx = queue[head++];
      size++;
      const x = idx % w;
      const y = (idx - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const n = ny * w + nx;
          if (bin[n] && labels[n] === 0) {
            labels[n] = nextId;
            queue[tail++] = n;
          }
        }
      }
    }
    sizes.push(size);
  }

  if (nextId < 2) return;

  let maxId = 1;
  for (let id = 2; id <= nextId; id++) {
    if (sizes[id] > sizes[maxId]) maxId = id;
  }

  for (let i = 0; i < bin.length; i++) {
    if (bin[i] && labels[i] !== maxId) bin[i] = 0;
  }
}

/**
 * 3x3 dilation of a binary mask. Used after keepLargestComponent to
 * widen the "keep" zone by 1 px so the narrow AA band that sits just
 * outside the thresholded silhouette (α in (0, 128)) survives.
 * Without this, zeroing everything outside the binary produces a
 * pixelated edge because the sub-threshold AA ring gets zeroed too.
 */
function dilate1(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (bin[idx]) { out[idx] = 1; continue; }
      let has = 0;
      for (let dy = -1; dy <= 1 && !has; dy++) {
        for (let dx = -1; dx <= 1 && !has; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (bin[ny * w + nx]) has = 1;
        }
      }
      out[idx] = has;
    }
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

  // Topology cleanup on the binary derivative: drop every opaque region
  // that isn't the main subject, regardless of size. Dilate by 1 to keep
  // the AA ring (α ∈ (0, 128)) that sits just outside the thresholded body.
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = sharp[i] >= 128 ? 1 : 0;
  keepLargestComponent(bin, w, h);
  const keep = dilate1(bin, w, h);

  for (let i = 0; i < n; i++) rgba[i * 4 + 3] = keep[i] ? sharp[i] : 0;

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
