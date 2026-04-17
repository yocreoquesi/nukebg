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
 * Mid-band quintic smoothstep on the RMBG soft-alpha gradient.
 *
 *   α ≤ LOW  → 0          (kills the halo tail; α<80 is halo on flat bg)
 *   α ≥ HIGH → 255         (interior, no feathering into the body)
 *   in-between → 6n⁵−15n⁴+10n³ normalized over [LOW, HIGH]
 *
 * Compromise between two earlier configs:
 *   - [100, 160] (narrow): halo tail 0.34%, but killed weak-body α<100
 *     so occluded edges (elbow, arm-torso gap) disappeared.
 *   - [60, 190] (wide): preserved the elbow, but re-introduced visible
 *     halo because α=60..99 (which is halo on flat backgrounds) now
 *     survived as semi-transparent.
 *
 * [80, 180] keeps halo cut tight (α<80 always killed) while letting the
 * weak-body band 80..130 survive as soft. If halo is still visible after
 * this pass, the next move is dropping the finalize module entirely and
 * relying on the worker-side spatialPass + morphOpen + guided filter.
 */
const SHARPEN_LOW = 80;
const SHARPEN_HIGH = 180;

/**
 * Halo-risk gate: if the RGB luminance variance inside the soft-α tail is
 * below this threshold, the background behind the subject is flat (sky,
 * wall, uniform grass) and finalize's alpha sharpening + foreground
 * decontamination will leave a visible halo band. In that case we skip
 * refineEdges and compose directly — at the cost of a slightly softer
 * edge, but without the halo. Textured backgrounds (foliage, crowd,
 * pattern) exceed this and get the full refinement.
 *
 * Threshold calibrated empirically: uniform sky ~2-10, green grass field
 * ~15-25, textured crowd/foliage ~40+. 25 is the line between "finalize
 * hurts" and "finalize helps" for the RMBG-1.4 output we see.
 */
const HALO_RISK_VARIANCE_THRESHOLD = 25;

/**
 * Per-pixel Rec. 709 luminance of the soft-α tail (α ∈ [30, 100]), then
 * variance across those samples. Low variance = flat bg behind the
 * subject = halo risk. Returns Infinity if the tail is too small to be
 * statistically meaningful (treat as safe → apply finalize).
 */
export function tailLuminanceVariance(
  workingRgba: Uint8ClampedArray,
  workingAlpha: Uint8Array,
): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < workingAlpha.length; i++) {
    const a = workingAlpha[i];
    if (a < 30 || a > 100) continue;
    const r = workingRgba[i * 4];
    const g = workingRgba[i * 4 + 1];
    const b = workingRgba[i * 4 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    sumSq += y * y;
    count++;
  }
  if (count < 100) return Infinity;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function hasHaloRisk(
  workingRgba: Uint8ClampedArray,
  workingAlpha: Uint8Array,
  threshold: number = HALO_RISK_VARIANCE_THRESHOLD,
): boolean {
  return tailLuminanceVariance(workingRgba, workingAlpha) < threshold;
}

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

  // Sharpen alpha FIRST. The solver receives the post-sharpen alpha, not
  // the raw RMBG output, so it only runs on the narrow AA band produced
  // by the quintic smoothstep (~1 px). Pixels that end up fully opaque
  // (sharp ≥ 254) keep their observed RGB verbatim — the estimator's
  // copy-through branch guarantees a 1:1 crop on the interior.
  //
  // This is the v2.6 behavior contract: the pipeline CROPS the original,
  // it never repaints the visible interior. We just also decontaminate
  // the one-pixel AA ring for clean composites on any background.
  const alphaRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) alphaRaw[i] = img.data[i * 4 + 3];
  const sharp = sharpenAlpha(alphaRaw);

  let rgba: Uint8ClampedArray;
  if (pipeline) {
    const observed = new Uint8ClampedArray(img.data);
    // The worker transfers (detaches) the alpha buffer, so pass a copy.
    const sharpForWorker = new Uint8Array(sharp);
    rgba = await pipeline.estimateForeground(observed, sharpForWorker, w, h);
  } else {
    rgba = new Uint8ClampedArray(img.data);
  }

  // Topology cleanup on the binary derivative. Three stages balancing
  // elbow preservation against halo elimination:
  //   1) bin = sharp >= 96: pixel counts toward "body" only if the
  //      sharpened α crossed into the upper half of the AA band. With
  //      [80, 180], sharp=96 means raw α ≈ 110 — past the thin halo tail
  //      but low enough to still include weakly-detected body regions.
  //      bin = sharp > 0 (the wide-band attempt) re-admitted halo pixels
  //      as first-class body and CC could not drop them because they
  //      touched the main silhouette.
  //   2) keepLargestComponent: drops detached blobs regardless of size.
  //   3) dilate1: widens the keep zone by 1 px so the extreme edge of the
  //      AA ring survives even if its immediate neighbor was zero-sharp.
  //
  // Binary threshold at 128 killed every body pixel under mid-confidence
  // (missing elbows/arms). sharp>0 brought back halo bands. sharp>=96 is
  // the middle ground — covers weakly-detected body, excludes halo tail.
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = sharp[i] >= 96 ? 1 : 0;
  keepLargestComponent(bin, w, h);
  const keep = dilate1(bin, w, h);

  for (let i = 0; i < n; i++) rgba[i * 4 + 3] = keep[i] ? sharp[i] : 0;

  return new ImageData(new Uint8ClampedArray(rgba), w, h);
}

/**
 * Full-pipeline convenience: compose the final RGBA at original resolution,
 * then run refineEdges on it. Main and batch paths use this; editor commit
 * paths call refineEdges directly on the already-composed editor output.
 *
 * When the soft-α tail behind the subject has low luminance variance
 * (flat background), we bypass refineEdges entirely. Finalize's sharpen
 * + decontamination produces visible halos in that case — the raw
 * JBU-upscaled alpha from composeAtOriginal reads cleaner on flat bg.
 */
export async function finalizeComposite(
  pipeline: ForegroundEstimator | null,
  input: Parameters<typeof composeAtOriginal>[0],
): Promise<ImageData> {
  const composed = composeAtOriginal(input);
  if (hasHaloRisk(input.workingRgba, input.workingAlpha)) return composed;
  return refineEdges(pipeline, composed);
}
