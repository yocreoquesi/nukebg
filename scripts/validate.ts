/**
 * Validation script — processes images through the CV pipeline
 * and saves results as PNG files for visual inspection.
 *
 * Usage: npx tsx scripts/validate.ts <image1.png> [image2.png] ...
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import CV algorithms directly
import { detectBgColors } from '../src/workers/cv/detect-bg-colors';
import { detectCheckerGrid } from '../src/workers/cv/detect-checker-grid';
import { gridFloodFill } from '../src/workers/cv/grid-flood-fill';
import { subjectExclusion } from '../src/workers/cv/subject-exclusion';
import { simpleFloodFill } from '../src/workers/cv/simple-flood-fill';
import { watermarkDetect } from '../src/workers/cv/watermark-detect';
import { shadowCleanup } from '../src/workers/cv/shadow-cleanup';
import { alphaRefine } from '../src/workers/cv/alpha-refine';
import { CV_PARAMS } from '../src/pipeline/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'test-output');

async function processImage(inputPath: string): Promise<void> {
  const name = path.basename(inputPath, path.extname(inputPath));
  console.log(`\n=== Processing: ${name} ===`);

  const img = sharp(inputPath).ensureAlpha();
  const meta = await img.metadata();
  const width = meta.width!;
  const height = meta.height!;
  const rawBuffer = await img.raw().toBuffer();
  const pixels = new Uint8ClampedArray(rawBuffer);

  console.log(`  Size: ${width}x${height}`);

  // Step 1: Detect background
  const t0 = performance.now();
  const bgInfo = detectBgColors(pixels, width, height);
  console.log(`  Background: ${bgInfo.isCheckerboard ? 'checkerboard' : 'solid'}`);
  console.log(`  Colors: dark=[${bgInfo.colorA}], light=[${bgInfo.colorB}]`);
  console.log(`  Variance: ${bgInfo.cornerVariance.toFixed(1)}`);

  let bgMask: Uint8Array;

  if (bgInfo.isCheckerboard) {
    const grid = detectCheckerGrid(
      new Uint8ClampedArray(pixels), width, height,
      bgInfo.colorA, bgInfo.colorB
    );
    console.log(`  Grid: size=${grid.gridSize}, phase=${grid.phase}`);

    if (grid.gridSize > 0) {
      bgMask = gridFloodFill(
        new Uint8ClampedArray(pixels), width, height,
        bgInfo.colorA, bgInfo.colorB,
        grid.gridSize, grid.phase
      );

      let bgCount = 0;
      for (let i = 0; i < bgMask.length; i++) if (bgMask[i]) bgCount++;
      const coverage = bgCount / (width * height);
      console.log(`  Grid flood coverage: ${(coverage * 100).toFixed(1)}%`);

      if (coverage < CV_PARAMS.LOW_COVERAGE_THRESHOLD) {
        console.log(`  Low coverage — subject exclusion + simple flood...`);
        const exclMask = subjectExclusion(
          new Uint8ClampedArray(pixels), width, height,
          bgInfo.colorA, bgInfo.colorB,
          grid.gridSize, grid.phase
        );
        const floodMask = simpleFloodFill(
          new Uint8ClampedArray(pixels), width, height,
          bgInfo.colorA, bgInfo.colorB
        );
        bgMask = new Uint8Array(width * height);
        for (let i = 0; i < bgMask.length; i++) {
          bgMask[i] = exclMask[i] || floodMask[i] ? 1 : 0;
        }
      }
    } else {
      bgMask = simpleFloodFill(
        new Uint8ClampedArray(pixels), width, height,
        bgInfo.colorA, bgInfo.colorB
      );
    }
  } else if (bgInfo.cornerVariance < CV_PARAMS.SOLID_BG_VARIANCE) {
    bgMask = simpleFloodFill(
      new Uint8ClampedArray(pixels), width, height,
      bgInfo.colorA, bgInfo.colorB
    );
  } else {
    console.log(`  Complex background — would need ML`);
    bgMask = simpleFloodFill(
      new Uint8ClampedArray(pixels), width, height,
      bgInfo.colorA, bgInfo.colorB
    );
  }

  let bgCount = 0;
  for (let i = 0; i < bgMask.length; i++) if (bgMask[i]) bgCount++;
  console.log(`  BG after flood: ${(bgCount / (width * height) * 100).toFixed(1)}%`);

  // Step 3: Watermark
  const wmResult = watermarkDetect(
    new Uint8ClampedArray(pixels), width, height,
    bgInfo.colorA, bgInfo.colorB
  );
  if (wmResult.detected && wmResult.mask) {
    const newMask = new Uint8Array(width * height);
    for (let i = 0; i < newMask.length; i++) {
      newMask[i] = bgMask[i] || wmResult.mask[i] ? 1 : 0;
    }
    bgMask = newMask;
    console.log(`  Watermark: removed`);
  } else {
    console.log(`  Watermark: not detected`);
  }

  // Step 4: Shadow cleanup
  bgMask = shadowCleanup(
    new Uint8ClampedArray(pixels), width, height,
    bgMask
  );

  // Step 5: Alpha refinement
  const alpha = alphaRefine(bgMask, width, height);

  const totalMs = performance.now() - t0;

  // Compose final RGBA
  const resultPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    resultPixels[i * 4] = pixels[i * 4];
    resultPixels[i * 4 + 1] = pixels[i * 4 + 1];
    resultPixels[i * 4 + 2] = pixels[i * 4 + 2];
    resultPixels[i * 4 + 3] = alpha[i];
  }

  let transparent = 0;
  for (let i = 0; i < width * height; i++) if (alpha[i] === 0) transparent++;
  console.log(`  Final: ${(transparent / (width * height) * 100).toFixed(1)}% transparent`);
  console.log(`  Time: ${totalMs.toFixed(0)}ms`);

  // Save transparent PNG
  const outPath = path.join(OUT_DIR, `${name}-clean.png`);
  await sharp(resultPixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);

  // Save on white for visual check
  const whitePixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i] / 255;
    whitePixels[i * 4] = Math.round(pixels[i * 4] * a + 255 * (1 - a));
    whitePixels[i * 4 + 1] = Math.round(pixels[i * 4 + 1] * a + 255 * (1 - a));
    whitePixels[i * 4 + 2] = Math.round(pixels[i * 4 + 2] * a + 255 * (1 - a));
    whitePixels[i * 4 + 3] = 255;
  }
  const verifyPath = path.join(OUT_DIR, `${name}-on-white.png`);
  await sharp(whitePixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(verifyPath);

  console.log(`  Output: ${outPath}`);
}

// Main
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: npx tsx scripts/validate.ts <image1.png> ...');
  process.exit(1);
}

for (const file of files) {
  await processImage(file);
}

console.log(`\nDone. Results in ${OUT_DIR}/`);
