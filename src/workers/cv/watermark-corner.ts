import { CORNER_WATERMARK_PARAMS } from '../../pipeline/constants';
import type { WatermarkResult } from '../../types/pipeline';
import { pixelIndex } from './utils';

/**
 * Generalized corner watermark detector. Scans all 4 corners for
 * logo/badge watermarks (Adobe Firefly CR icon, Canva badge, etc.).
 *
 * Algorithm per corner:
 * 1. Define scan region from corner
 * 2. Estimate local background from border strips
 * 3. Compute color deviation map from background
 * 4. Threshold deviation to find candidate pixels
 * 5. Find connected components (flood fill)
 * 6. Filter by size, aspect ratio, edge proximity
 * 7. Build circular mask around valid clusters
 */
export function watermarkDetectCorner(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WatermarkResult {
  const {
    MIN_SCAN_SIZE,
    SCAN_FRACTION,
    BORDER_STRIP_WIDTH,
    DEVIATION_THRESHOLD,
    MIN_CLUSTER_PIXELS,
    MAX_CLUSTER_RATIO,
    MIN_ASPECT_RATIO,
    MAX_ASPECT_RATIO,
    MASK_PADDING,
    MASK_HALO_MULTIPLIER,
  } = CORNER_WATERMARK_PARAMS;

  const totalPixels = width * height;
  const maxClusterPixels = Math.floor(totalPixels * MAX_CLUSTER_RATIO);
  const cornerSize = Math.max(
    MIN_SCAN_SIZE,
    Math.floor(Math.min(width, height) / SCAN_FRACTION),
  );

  // Cannot scan if image is too small
  if (cornerSize > width || cornerSize > height) {
    return { detected: false, mask: null };
  }

  // Define corner origins: [x0, y0] for the top-left pixel of each corner region
  const corners: Array<[number, number]> = [
    [0, 0],                                        // top-left
    [width - cornerSize, 0],                        // top-right
    [0, height - cornerSize],                       // bottom-left
    [width - cornerSize, height - cornerSize],      // bottom-right
  ];

  const detectedClusters: Array<{
    centerX: number;
    centerY: number;
    radius: number;
  }> = [];

  for (const [cx0, cy0] of corners) {
    const cluster = detectCornerLogo(
      pixels, width, height,
      cx0, cy0, cornerSize,
      BORDER_STRIP_WIDTH, DEVIATION_THRESHOLD,
      MIN_CLUSTER_PIXELS, maxClusterPixels,
      MIN_ASPECT_RATIO, MAX_ASPECT_RATIO,
    );

    if (cluster) {
      detectedClusters.push(cluster);
    }
  }

  if (detectedClusters.length === 0) {
    return { detected: false, mask: null };
  }

  // Build combined mask
  const mask = new Uint8Array(totalPixels);

  for (const cluster of detectedClusters) {
    const radius = Math.floor(cluster.radius * MASK_HALO_MULTIPLIER) + MASK_PADDING;
    const cxAbs = cluster.centerX;
    const cyAbs = cluster.centerY;

    const yMin = Math.max(0, cyAbs - radius);
    const yMax = Math.min(height - 1, cyAbs + radius);
    const xMin = Math.max(0, cxAbs - radius);
    const xMax = Math.min(width - 1, cxAbs + radius);

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const dist = Math.sqrt((y - cyAbs) ** 2 + (x - cxAbs) ** 2);
        if (dist <= radius) {
          mask[y * width + x] = 1;
        }
      }
    }
  }

  return {
    detected: true,
    mask,
    centerX: detectedClusters[0].centerX,
    centerY: detectedClusters[0].centerY,
    radius: detectedClusters[0].radius,
  };
}

/**
 * Detect a logo-like cluster in a single corner region.
 * Returns cluster info if found, null otherwise.
 */
function detectCornerLogo(
  pixels: Uint8ClampedArray,
  width: number,
  _height: number,
  cx0: number,
  cy0: number,
  cornerSize: number,
  borderStripWidth: number,
  deviationThreshold: number,
  minClusterPixels: number,
  maxClusterPixels: number,
  minAspectRatio: number,
  maxAspectRatio: number,
): { centerX: number; centerY: number; radius: number } | null {
  // Estimate background color from border strips (outer N px of corner region)
  let sumR = 0, sumG = 0, sumB = 0;
  let borderCount = 0;

  for (let ly = 0; ly < cornerSize; ly++) {
    for (let lx = 0; lx < cornerSize; lx++) {
      const isBorder =
        ly < borderStripWidth ||
        ly >= cornerSize - borderStripWidth ||
        lx < borderStripWidth ||
        lx >= cornerSize - borderStripWidth;

      if (!isBorder) continue;

      const gx = cx0 + lx;
      const gy = cy0 + ly;
      const idx = pixelIndex(gx, gy, width);
      sumR += pixels[idx];
      sumG += pixels[idx + 1];
      sumB += pixels[idx + 2];
      borderCount++;
    }
  }

  if (borderCount === 0) return null;

  const bgR = sumR / borderCount;
  const bgG = sumG / borderCount;
  const bgB = sumB / borderCount;

  // Compute deviation map and find deviant pixels
  const deviantPixels: Array<[number, number]> = []; // [lx, ly] local coords
  const deviantSet = new Uint8Array(cornerSize * cornerSize);

  for (let ly = 0; ly < cornerSize; ly++) {
    for (let lx = 0; lx < cornerSize; lx++) {
      const gx = cx0 + lx;
      const gy = cy0 + ly;
      const idx = pixelIndex(gx, gy, width);
      const dr = pixels[idx] - bgR;
      const dg = pixels[idx + 1] - bgG;
      const db = pixels[idx + 2] - bgB;
      const deviation = Math.sqrt(dr * dr + dg * dg + db * db);

      if (deviation > deviationThreshold) {
        deviantPixels.push([lx, ly]);
        deviantSet[ly * cornerSize + lx] = 1;
      }
    }
  }

  if (deviantPixels.length < minClusterPixels) return null;

  // Find connected components via flood fill
  const visited = new Uint8Array(cornerSize * cornerSize);
  const clusters: Array<Array<[number, number]>> = [];

  for (const [startLx, startLy] of deviantPixels) {
    if (visited[startLy * cornerSize + startLx]) continue;
    if (!deviantSet[startLy * cornerSize + startLx]) continue;

    // BFS flood fill
    const component: Array<[number, number]> = [];
    const queue: Array<[number, number]> = [[startLx, startLy]];
    visited[startLy * cornerSize + startLx] = 1;

    while (queue.length > 0) {
      const [qx, qy] = queue.pop()!;
      component.push([qx, qy]);

      // 4-connected neighbors
      const neighbors: Array<[number, number]> = [
        [qx - 1, qy], [qx + 1, qy],
        [qx, qy - 1], [qx, qy + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (
          nx >= 0 && nx < cornerSize &&
          ny >= 0 && ny < cornerSize &&
          !visited[ny * cornerSize + nx] &&
          deviantSet[ny * cornerSize + nx]
        ) {
          visited[ny * cornerSize + nx] = 1;
          queue.push([nx, ny]);
        }
      }
    }

    if (component.length >= minClusterPixels) {
      clusters.push(component);
    }
  }

  // Evaluate each cluster
  for (const component of clusters) {
    if (component.length > maxClusterPixels) continue;

    // Compute bounding box
    let minLx = cornerSize, maxLx = 0, minLy = cornerSize, maxLy = 0;
    for (const [lx, ly] of component) {
      if (lx < minLx) minLx = lx;
      if (lx > maxLx) maxLx = lx;
      if (ly < minLy) minLy = ly;
      if (ly > maxLy) maxLy = ly;
    }

    const bboxW = maxLx - minLx + 1;
    const bboxH = maxLy - minLy + 1;

    // Aspect ratio filter
    if (bboxH === 0) continue;
    const aspect = bboxW / bboxH;
    if (aspect < minAspectRatio || aspect > maxAspectRatio) continue;

    // Convert to absolute coordinates
    const centerLx = (minLx + maxLx) / 2;
    const centerLy = (minLy + maxLy) / 2;
    const radius = Math.max(bboxW, bboxH) / 2;

    return {
      centerX: Math.round(cx0 + centerLx),
      centerY: Math.round(cy0 + centerLy),
      radius: Math.round(radius),
    };
  }

  return null;
}
