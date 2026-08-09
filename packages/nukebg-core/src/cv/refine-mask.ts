import { REFINE_PARAMS } from '../pipeline/constants.js';
import type { RmbgRefineOptions } from '../runners/rmbg-runner.js';

/**
 * RMBG mask refinement.
 *
 * Moved out of `packages/nukebg-app/src/workers/ml.worker.ts`, where these
 * four functions lived as private module-local helpers. That is why the Node
 * runner silently ignored `opts.refine`: there was nothing in core to call,
 * so `--precision` only ever moved `rmbgThreshold` and the CLI shipped the
 * speckle noise the browser removed on every segmentation.
 *
 * Pure: no DOM, no globals, no I/O. Same output for the same input.
 */

/**
 * Single spatial refinement pass at a given radius.
 *
 * Looks only at the neighbourhood, never at colour, so it still works when
 * the subject outline matches the background (dark outline on a dark
 * checkerboard). Semi-transparent pixels mostly surrounded by transparency
 * are residue and get dropped; ones mostly surrounded by opacity belong to
 * the subject and get pushed towards opaque.
 */
export function spatialPass(
  alpha: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const result = new Uint8Array(alpha);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x] ?? 0;
      // Only edge pixels are candidates: fully transparent or fully opaque
      // pixels are already decided.
      if (a < 1 || a > 240) continue;

      let opaqueCount = 0;
      let transparentCount = 0;
      let totalCount = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          totalCount++;
          const na = alpha[ny * w + nx] ?? 0;
          if (na > 200) opaqueCount++;
          else if (na < 30) transparentCount++;
        }
      }

      if (totalCount === 0) continue;

      const transparentRatio = transparentCount / totalCount;
      const opaqueRatio = opaqueCount / totalCount;

      if (transparentRatio > 0.6) {
        result[y * w + x] = 0;
      } else if (opaqueRatio > 0.5) {
        result[y * w + x] = Math.min(255, Math.round(a * 1.3));
      }
    }
  }

  return result;
}

/**
 * Morphological opening (erode then dilate) on the alpha mask.
 *
 * Erode removes thin protrusions and orphan edge pixels; dilate restores the
 * main shape to its original size. Alpha values are preserved wherever a
 * pixel survives — only rejected pixels are zeroed.
 */
export function morphOpen(
  alpha: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const threshold = 128;

  // Erode: a pixel stays only if EVERY neighbour within radius is opaque.
  // Out-of-bounds counts as not-opaque, so the border erodes too.
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((alpha[y * w + x] ?? 0) < threshold) continue;
      let allOpaque = true;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) {
            allOpaque = false;
            break outer;
          }
          if ((alpha[ny * w + nx] ?? 0) < threshold) {
            allOpaque = false;
            break outer;
          }
        }
      }
      if (allOpaque) eroded[y * w + x] = alpha[y * w + x] ?? 0;
    }
  }

  // Dilate: a pixel is restored if ANY neighbour survived erosion.
  const result = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((eroded[y * w + x] ?? 0) >= threshold) {
        result[y * w + x] = alpha[y * w + x] ?? 0;
        continue;
      }
      let hasOpaqueNeighbor = false;
      for (let dy = -radius; dy <= radius && !hasOpaqueNeighbor; dy++) {
        for (let dx = -radius; dx <= radius && !hasOpaqueNeighbor; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (
            ny >= 0 &&
            ny < h &&
            nx >= 0 &&
            nx < w &&
            (eroded[ny * w + nx] ?? 0) >= threshold
          ) {
            hasOpaqueNeighbor = true;
          }
        }
      }
      result[y * w + x] = hasOpaqueNeighbor ? (alpha[y * w + x] ?? 0) : 0;
    }
  }

  return result;
}

/**
 * Drop opaque clusters that are not the subject.
 *
 * Flood-fills 4-connected components over alpha > 30, keeps the largest
 * (the subject), and removes any component below both the absolute
 * `minSize` and `clusterRatio` of the largest.
 */
export function removeSmallClusters(
  alpha: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  clusterRatio?: number,
): Uint8Array {
  const result = new Uint8Array(alpha);
  const visited = new Uint8Array(w * h);

  const components: Array<{ indices: number[]; size: number }> = [];

  for (let i = 0; i < w * h; i++) {
    if ((alpha[i] ?? 0) <= 30 || visited[i]) continue;

    // BFS flood fill, FIFO via a head pointer (no shift() on a large array).
    const indices: number[] = [];
    const queue: number[] = [i];
    let head = 0;
    visited[i] = 1;

    while (head < queue.length) {
      const idx = queue[head++]!;
      indices.push(idx);
      const cx = idx % w;
      const cy = (idx - cx) / w;

      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (!visited[ni] && (alpha[ni] ?? 0) > 30) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    components.push({ indices, size: indices.length });
  }

  if (components.length === 0) return result;
  const maxSize = Math.max(...components.map((c) => c.size));

  const ratio = clusterRatio ?? REFINE_PARAMS.CLUSTER_RATIO;
  const relativeMin = Math.max(minSize, Math.round(maxSize * ratio));
  for (const comp of components) {
    if (comp.size < relativeMin && comp.size < maxSize) {
      for (const idx of comp.indices) {
        result[idx] = 0;
      }
    }
  }

  return result;
}

/**
 * Full refinement chain applied to a raw RMBG alpha mask: spatial passes,
 * then optional morphological opening, then small-cluster removal.
 *
 * Every field of `RmbgRefineOptions` is optional here and falls back to
 * `REFINE_PARAMS`, so callers holding a partial profile (the browser worker's
 * `MlRefineOptions`) and callers holding a full one (`PRECISION_PROFILES`
 * via the runner contract) can both use it.
 */
export function refineMask(
  alpha: Uint8Array,
  w: number,
  h: number,
  opts?: Partial<RmbgRefineOptions>,
): Uint8Array {
  const spatialPasses = opts?.spatialPasses ?? 1;
  const spatialRadius = opts?.spatialRadius ?? REFINE_PARAMS.SPATIAL_RADIUS;
  const morphRadius = opts?.morphOpenRadius ?? REFINE_PARAMS.MORPH_OPEN_RADIUS;
  const minCluster = opts?.minClusterSize ?? REFINE_PARAMS.MIN_CLUSTER_SIZE;

  // Annotated rather than inferred: `new Uint8Array(alpha)` narrows to
  // `Uint8Array<ArrayBuffer>`, while the helpers below return the wider
  // `Uint8Array<ArrayBufferLike>`, so the reassignments would not typecheck
  // under the app's stricter lib.
  let result: Uint8Array = new Uint8Array(alpha);

  for (let i = 0; i < spatialPasses; i++) {
    result = spatialPass(result, w, h, spatialRadius);
  }

  if (morphRadius > 0) {
    result = morphOpen(result, w, h, morphRadius);
  }

  return removeSmallClusters(result, w, h, minCluster, opts?.clusterRatio);
}
