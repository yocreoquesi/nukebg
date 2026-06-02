import { createImageDataLike } from '../types/image-data-like.js';
import type { ImageDataLike } from '../types/image-data-like.js';

/**
 * Edge refinement for the final cutout: decontaminate foreground RGB, then
 * sharpen the soft alpha tails so the exported image reads clean on any
 * background (white, black, colored).
 *
 * Moved from packages/nukebg-app/src/pipeline/finalize.ts in Phase 8.
 * All `new ImageData(...)` calls replaced with `createImageDataLike(...)`.
 * No DOM globals used.
 */

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
 */
const SHARPEN_LOW = 80;
const SHARPEN_HIGH = 180;

/**
 * Halo-risk gate: if the RGB luminance variance inside the soft-α tail is
 * below this threshold, the background behind the subject is flat.
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
    if (a === undefined || a < 30 || a > 100) continue;
    const r = workingRgba[i * 4] ?? 0;
    const g = workingRgba[i * 4 + 1] ?? 0;
    const b = workingRgba[i * 4 + 2] ?? 0;
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

/**
 * Largest hole size to auto-fill.
 */
const MAX_HOLE_FILL_SIZE_PX = 200;

/**
 * Fill disconnected α=0 regions inside the subject.
 */
export function fillSubjectHoles(
  img: ImageDataLike,
  maxHoleSize: number = MAX_HOLE_FILL_SIZE_PX,
): ImageDataLike {
  const { data, width, height } = img;
  const n = width * height;
  const queue = new Int32Array(n);
  const bgVisited = new Uint8Array(n);
  let head = 0,
    tail = 0;

  const seedBg = (idx: number) => {
    if ((data[idx * 4 + 3] ?? 0) === 0 && !bgVisited[idx]) {
      bgVisited[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let x = 0; x < width; x++) {
    seedBg(x);
    if (height > 1) seedBg((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seedBg(y * width);
    seedBg(y * width + width - 1);
  }

  while (head < tail) {
    const idx = queue[head++] ?? 0;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) {
      const ni = idx - 1;
      if (!bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
        bgVisited[ni] = 1;
        queue[tail++] = ni;
      }
    }
    if (x < width - 1) {
      const ni = idx + 1;
      if (!bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
        bgVisited[ni] = 1;
        queue[tail++] = ni;
      }
    }
    if (y > 0) {
      const ni = idx - width;
      if (!bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
        bgVisited[ni] = 1;
        queue[tail++] = ni;
      }
    }
    if (y < height - 1) {
      const ni = idx + width;
      if (!bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
        bgVisited[ni] = 1;
        queue[tail++] = ni;
      }
    }
  }

  const holeVisited = new Uint8Array(n);
  const holeIndices = new Int32Array(n);
  const out = new Uint8ClampedArray(data);

  for (let start = 0; start < n; start++) {
    if ((data[start * 4 + 3] ?? 0) !== 0) continue;
    if (bgVisited[start] || holeVisited[start]) continue;

    head = 0;
    tail = 0;
    let size = 0;
    queue[tail++] = start;
    holeVisited[start] = 1;
    holeIndices[size++] = start;

    while (head < tail) {
      const idx = queue[head++] ?? 0;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0) {
        const ni = idx - 1;
        if (!holeVisited[ni] && !bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
          holeVisited[ni] = 1;
          queue[tail++] = ni;
          holeIndices[size++] = ni;
        }
      }
      if (x < width - 1) {
        const ni = idx + 1;
        if (!holeVisited[ni] && !bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
          holeVisited[ni] = 1;
          queue[tail++] = ni;
          holeIndices[size++] = ni;
        }
      }
      if (y > 0) {
        const ni = idx - width;
        if (!holeVisited[ni] && !bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
          holeVisited[ni] = 1;
          queue[tail++] = ni;
          holeIndices[size++] = ni;
        }
      }
      if (y < height - 1) {
        const ni = idx + width;
        if (!holeVisited[ni] && !bgVisited[ni] && (data[ni * 4 + 3] ?? 0) === 0) {
          holeVisited[ni] = 1;
          queue[tail++] = ni;
          holeIndices[size++] = ni;
        }
      }
    }

    if (size <= maxHoleSize) {
      for (let i = 0; i < size; i++) {
        const hi = holeIndices[i];
        if (hi !== undefined) out[hi * 4 + 3] = 255;
      }
    }
  }

  return createImageDataLike(out, width, height);
}

/**
 * Topology-only cleanup: zero α on any pixel that isn't part of the largest
 * 8-connected component of the subject mask.
 */
const ORPHAN_KEEP_RATIO = 0.01; // ≥1% of the largest blob

export function dropOrphanBlobs(img: ImageDataLike): ImageDataLike {
  const { data, width, height } = img;
  const n = width * height;
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = (data[i * 4 + 3] ?? 0) > 0 ? 1 : 0;

  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const sizes: number[] = [0]; // id 0 = background
  let nextId = 0;

  for (let i = 0; i < n; i++) {
    if (bin[i] === 0 || labels[i] !== 0) continue;
    nextId++;
    labels[i] = nextId;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    let size = 0;
    while (head < tail) {
      const idx = queue[head++] ?? 0;
      size++;
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (bin[ni] && labels[ni] === 0) {
            labels[ni] = nextId;
            queue[tail++] = ni;
          }
        }
      }
    }
    sizes.push(size);
  }

  if (nextId < 2) return img;

  let maxSize = 0;
  for (let id = 1; id <= nextId; id++) {
    if ((sizes[id] ?? 0) > maxSize) maxSize = sizes[id] ?? 0;
  }
  const threshold = Math.max(2, Math.floor(maxSize * ORPHAN_KEEP_RATIO));

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) {
    const label = labels[i] ?? 0;
    if (bin[i] && (sizes[label] ?? 0) < threshold) {
      out[i * 4 + 3] = 0;
    }
  }
  return createImageDataLike(out, width, height);
}

/**
 * Promote semi-transparent specks surrounded by a dense opaque neighborhood
 * to α=255.
 */
export function promoteSpeckleAlpha(
  img: ImageDataLike,
  radius: number = 2,
  ratio: number = 0.75,
  opaqueAlphaThresh: number = 240,
): ImageDataLike {
  const { data, width, height } = img;
  const n = width * height;
  const alphaSnapshot = new Uint8Array(n);
  for (let i = 0; i < n; i++) alphaSnapshot[i] = data[i * 4 + 3] ?? 0;

  const area = (2 * radius + 1) * (2 * radius + 1) - 1;
  const minOpaque = Math.ceil(ratio * area);
  const out = new Uint8ClampedArray(data);

  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const i = y * width + x;
      const a = alphaSnapshot[i] ?? 0;
      if (a === 0 || a === 255) continue;

      let opaque = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = (y + dy) * width;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          if ((alphaSnapshot[row + x + dx] ?? 0) >= opaqueAlphaThresh) opaque++;
        }
      }
      if (opaque >= minOpaque) out[i * 4 + 3] = 255;
    }
  }

  return createImageDataLike(out, width, height);
}

export function sharpenAlpha(alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(alpha.length);
  const range = SHARPEN_HIGH - SHARPEN_LOW;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] ?? 0;
    if (a <= SHARPEN_LOW) {
      out[i] = 0;
      continue;
    }
    if (a >= SHARPEN_HIGH) {
      out[i] = 255;
      continue;
    }
    const n = (a - SHARPEN_LOW) / range;
    const s = n * n * n * (n * (n * 6 - 15) + 10);
    const v = Math.round(s * 255);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * In-place 8-connected component labelling; keep only the largest component.
 */
export function keepLargestComponent(bin: Uint8Array, w: number, h: number): void {
  const labels = new Int32Array(bin.length);
  const queue = new Int32Array(bin.length);
  const sizes: number[] = [0];

  let nextId = 0;
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 0 || labels[i] !== 0) continue;
    nextId++;
    labels[i] = nextId;
    let head = 0,
      tail = 0;
    queue[tail++] = i;
    let size = 0;
    while (head < tail) {
      const idx = queue[head++] ?? 0;
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
    if ((sizes[id] ?? 0) > (sizes[maxId] ?? 0)) maxId = id;
  }

  for (let i = 0; i < bin.length; i++) {
    if (bin[i] && labels[i] !== maxId) bin[i] = 0;
  }
}

/**
 * 3x3 dilation of a binary mask.
 */
function dilate1(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (bin[idx]) {
        out[idx] = 1;
        continue;
      }
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
 * Refine an already-composed RGBA ImageDataLike: decontaminate RGB (if a
 * pipeline is available to run the worker-side solver) and sharpen α.
 *
 * Returns a fresh ImageDataLike; does not mutate the input.
 */
export async function refineEdges(
  pipeline: ForegroundEstimator | null,
  img: ImageDataLike,
  options: { skipTopologyCleanup?: boolean } = {},
): Promise<ImageDataLike> {
  const w = img.width;
  const h = img.height;
  const n = w * h;

  const alphaRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) alphaRaw[i] = img.data[i * 4 + 3] ?? 0;
  const sharp = sharpenAlpha(alphaRaw);

  let rgba: Uint8ClampedArray;
  if (pipeline) {
    const observed = new Uint8ClampedArray(img.data);
    const sharpForWorker = new Uint8Array(sharp);
    rgba = await pipeline.estimateForeground(observed, sharpForWorker, w, h);
  } else {
    rgba = new Uint8ClampedArray(img.data);
  }

  if (options.skipTopologyCleanup) {
    for (let i = 0; i < n; i++) rgba[i * 4 + 3] = sharp[i] ?? 0;
  } else {
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = (sharp[i] ?? 0) >= 96 ? 1 : 0;
    keepLargestComponent(bin, w, h);
    const keep = dilate1(bin, w, h);
    for (let i = 0; i < n; i++) rgba[i * 4 + 3] = keep[i] ? (sharp[i] ?? 0) : 0;
  }

  return createImageDataLike(new Uint8ClampedArray(rgba), w, h);
}
