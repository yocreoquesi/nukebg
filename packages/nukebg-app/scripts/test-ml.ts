/**
 * Test that the ML pipeline works end-to-end with real images.
 * Uses @huggingface/transformers directly (same as ml.worker.ts).
 *
 * Usage: npx tsx scripts/test-ml.ts <image.png> [image2.png] ...
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'test-output');

async function testImage(inputPath: string): Promise<boolean> {
  const name = path.basename(inputPath, path.extname(inputPath));
  console.log(`\n=== ${name} ===`);

  // Load image
  const img = sharp(inputPath).ensureAlpha();
  const meta = await img.metadata();
  const width = meta.width!;
  const height = meta.height!;
  const rawBuffer = await img.raw().toBuffer();
  const pixels = new Uint8ClampedArray(rawBuffer);
  console.log(`  Size: ${width}x${height}`);

  // Import transformers.js
  const { pipeline, RawImage, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;

  // Load model (same as ml.worker.ts)
  console.log('  Loading IS-Net model...');
  const t0 = performance.now();
  const segmenter = await pipeline('image-segmentation', 'Xenova/isnet-general-use');
  console.log(`  Model loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Create RawImage and segment
  const image = new RawImage(pixels, width, height, 4);
  console.log('  Running segmentation...');
  const t1 = performance.now();
  const results = await segmenter(image, { threshold: 0.5, return_mask: true });
  const segTime = performance.now() - t1;
  console.log(`  Segmentation: ${(segTime / 1000).toFixed(1)}s`);

  // Extract mask
  const maskImage = (results as any)[0]?.mask;
  if (!maskImage) {
    console.error('  FAIL: No mask returned');
    return false;
  }

  const maskData = maskImage.data;
  const maskW = maskImage.width;
  const maskH = maskImage.height;
  console.log(`  Mask: ${maskW}x${maskH}`);

  // Convert to alpha
  const scaleX = maskW / width;
  const scaleY = maskH / height;
  const resultPixels = Buffer.alloc(width * height * 4);
  let fgCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), maskW - 1);
      const srcY = Math.min(Math.floor(y * scaleY), maskH - 1);
      const maskVal = maskData[srcY * maskW + srcX];
      const i = y * width + x;

      resultPixels[i * 4] = pixels[i * 4];
      resultPixels[i * 4 + 1] = pixels[i * 4 + 1];
      resultPixels[i * 4 + 2] = pixels[i * 4 + 2];
      resultPixels[i * 4 + 3] = maskVal;

      if (maskVal > 128) fgCount++;
    }
  }

  const fgPct = ((100 * fgCount) / (width * height)).toFixed(1);
  console.log(`  Foreground: ${fgPct}%`);

  // Save
  const outPath = path.join(OUT_DIR, `${name}-ml-test.png`);
  await sharp(resultPixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);

  // On white
  const whitePixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = resultPixels[i * 4 + 3] / 255;
    whitePixels[i * 4] = Math.round(resultPixels[i * 4] * a + 255 * (1 - a));
    whitePixels[i * 4 + 1] = Math.round(resultPixels[i * 4 + 1] * a + 255 * (1 - a));
    whitePixels[i * 4 + 2] = Math.round(resultPixels[i * 4 + 2] * a + 255 * (1 - a));
    whitePixels[i * 4 + 3] = 255;
  }
  const whitePath = path.join(OUT_DIR, `${name}-ml-test-on-white.png`);
  await sharp(whitePixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(whitePath);

  console.log(`  Output: ${outPath}`);
  console.log(`  PASS`);
  return true;
}

// Main
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: npx tsx scripts/test-ml.ts <image.png> ...');
  process.exit(1);
}

let passed = 0;
let failed = 0;
for (const file of files) {
  const ok = await testImage(file);
  if (ok) passed++;
  else failed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
