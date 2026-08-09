/**
 * Remove background from images using RMBG-1.4.
 * Outputs <name>-clean.png next to the input file.
 *
 * Usage: npx tsx scripts/remove-bg-rmbg.ts <image.png> [image2.png] ...
 */
import sharp from 'sharp';
import { existsSync } from 'fs';
import path from 'path';

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

  // Load model (RMBG-1.4 — same as ml.worker.ts)
  console.log('  Loading RMBG-1.4 model...');
  const t0 = performance.now();
  const segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', { device: 'cpu' });
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

  // Save next to input as <name>-clean.png
  const outPath = path.join(path.dirname(inputPath), `${name}-clean.png`);
  await sharp(resultPixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outPath);

  console.log(`  Output: ${outPath}`);
  console.log(`  PASS`);
  return true;
}

// Main
const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: npx tsx scripts/remove-bg-rmbg.ts <image.png> ...');
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
