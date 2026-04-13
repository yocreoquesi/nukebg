/**
 * Benchmark: NukeBG's Telea FMM inpainting vs reference Python impl.
 *
 * Reference repo:
 *   https://github.com/MilesWeberman/Image-Inpainting-Algorithm-Based-on-the-Fast-Marching-Method
 *
 * For each of the 5 test cases we:
 *   1. Download input + mask + reference result (Telea, epsilon=3)
 *   2. Run our inpaintTelea(radius=3) on the input + mask
 *   3. Compare our output vs the reference result with:
 *      - MAE (mean absolute error, 0-255 scale)
 *      - PSNR (peak signal-to-noise ratio, dB)
 *      - Masked PSNR (only inside the inpainted region — this is what matters)
 *   4. Save our output PNG to benchmark/outputs/ for visual inspection.
 *
 * Run: npx tsx benchmark/telea-vs-reference.ts
 */

import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inpaintTelea } from '../src/workers/cv/inpaint-telea.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const OUTPUTS = join(__dirname, 'outputs');

const REPO_RAW =
  'https://raw.githubusercontent.com/MilesWeberman/Image-Inpainting-Algorithm-Based-on-the-Fast-Marching-Method/main';

interface Case {
  id: number;
  input: string;
  mask: string;
  reference: string;
}

const CASES: Case[] = [
  { id: 1, input: 'Inputs/input_img1.png', mask: 'Inputs/mask1.png', reference: 'Results/Result_1_e3_Telea.png' },
  { id: 2, input: 'Inputs/src_img2.jpg', mask: 'Inputs/mask2.jpg', reference: 'Results/Result_2_e3_Telea.png' },
  { id: 3, input: 'Inputs/src_img3.jpg', mask: 'Inputs/mask3.jpg', reference: 'Results/Result_3_e3_Telea.png' },
  { id: 4, input: 'Inputs/src_img4.jpg', mask: 'Inputs/mask4.jpg', reference: 'Results/Result_4_e3_Telea.png' },
  { id: 5, input: 'Inputs/src_img5.jpg', mask: 'Inputs/mask5.jpg', reference: 'Results/Result_5_e3_Telea.png' },
];

async function downloadIfMissing(remote: string, local: string): Promise<void> {
  if (existsSync(local)) return;
  await mkdir(dirname(local), { recursive: true });
  const url = `${REPO_RAW}/${remote}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(local, buf);
  console.log(`  ✓ cached ${remote} (${(buf.length / 1024).toFixed(0)} KB)`);
}

/** Load an RGB image as Uint8ClampedArray (RGBA stream, 4 bytes/pixel). */
async function loadRgba(path: string): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/** Load and resize an image to the exact target size (RGBA). */
async function loadRgbaAtSize(
  path: string,
  width: number,
  height: number,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  const { data } = await sharp(path)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
  };
}

/** Load a mask (any image) as Uint8Array — non-zero = pixel to inpaint. */
async function loadMask(path: string, width: number, height: number): Promise<Uint8Array> {
  const { data, info } = await sharp(path)
    .resize(width, height, { fit: 'fill', kernel: 'nearest' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== width || info.height !== height) {
    throw new Error(`Mask size mismatch after resize: ${info.width}x${info.height} vs ${width}x${height}`);
  }

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    // Match reference Python's semantics: any non-zero = inpaint.
    // We still allow a tiny tolerance for JPG compression noise on nominally
    // black backgrounds (sharp may decode 0→0..2).
    mask[i] = data[i] > 2 ? 1 : 0;
  }
  return mask;
}

/** Save an RGBA side-by-side diff between ours and reference. */
async function saveDiff(
  ours: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  width: number,
  height: number,
  path: string,
): Promise<void> {
  const composite = new Uint8ClampedArray(width * height * 4 * 2);
  // Left half: ours. Right half: reference. Amplified absolute diff below would
  // need a different layout; we keep this simple so the user can eyeball.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcOff = (y * width + x) * 4;
      const dstOffLeft = (y * width * 2 + x) * 4;
      const dstOffRight = (y * width * 2 + (x + width)) * 4;
      composite[dstOffLeft] = ours[srcOff];
      composite[dstOffLeft + 1] = ours[srcOff + 1];
      composite[dstOffLeft + 2] = ours[srcOff + 2];
      composite[dstOffLeft + 3] = 255;
      composite[dstOffRight] = reference[srcOff];
      composite[dstOffRight + 1] = reference[srcOff + 1];
      composite[dstOffRight + 2] = reference[srcOff + 2];
      composite[dstOffRight + 3] = 255;
    }
  }
  await sharp(Buffer.from(composite.buffer, composite.byteOffset, composite.byteLength), {
    raw: { width: width * 2, height, channels: 4 },
  })
    .png()
    .toFile(path);
}

/** Save RGBA pixel array as PNG. */
async function saveRgbaAsPng(pixels: Uint8ClampedArray, width: number, height: number, path: string): Promise<void> {
  await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(path);
}

interface Metrics {
  maeGlobal: number;
  psnrGlobal: number;
  maeMasked: number;
  psnrMasked: number;
  maskedPixelCount: number;
}

function computeMetrics(
  ours: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
): Metrics {
  const total = width * height;
  let sumSqGlobal = 0;
  let sumAbsGlobal = 0;
  let sumSqMasked = 0;
  let sumAbsMasked = 0;
  let maskedCount = 0;

  for (let i = 0; i < total; i++) {
    const off = i * 4;
    const isMasked = mask[i] !== 0;
    for (let c = 0; c < 3; c++) {
      const diff = ours[off + c] - reference[off + c];
      const sq = diff * diff;
      const abs = Math.abs(diff);
      sumSqGlobal += sq;
      sumAbsGlobal += abs;
      if (isMasked) {
        sumSqMasked += sq;
        sumAbsMasked += abs;
      }
    }
    if (isMasked) maskedCount++;
  }

  const globalSamples = total * 3;
  const maskedSamples = maskedCount * 3;

  const mseGlobal = sumSqGlobal / globalSamples;
  const mseMasked = maskedSamples > 0 ? sumSqMasked / maskedSamples : 0;

  const psnr = (mse: number): number => (mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse));

  return {
    maeGlobal: sumAbsGlobal / globalSamples,
    psnrGlobal: psnr(mseGlobal),
    maeMasked: maskedSamples > 0 ? sumAbsMasked / maskedSamples : 0,
    psnrMasked: psnr(mseMasked),
    maskedPixelCount: maskedCount,
  };
}

async function runCase(c: Case): Promise<Metrics & { ms: number; width: number; height: number }> {
  const inputPath = join(FIXTURES, c.input);
  const maskPath = join(FIXTURES, c.mask);
  const refPath = join(FIXTURES, c.reference);

  console.log(`\nCase ${c.id}:`);
  await downloadIfMissing(c.input, inputPath);
  await downloadIfMissing(c.mask, maskPath);
  await downloadIfMissing(c.reference, refPath);

  // Reference results in the repo are often saved at lower resolution than
  // the source inputs. Use the reference's dimensions as the ground truth
  // size and resize the input + mask to match, so we compare apples to apples.
  const reference = await loadRgba(refPath);
  const input = await loadRgbaAtSize(inputPath, reference.width, reference.height);
  const mask = await loadMask(maskPath, reference.width, reference.height);

  // Matches the reference pipeline's epsilon=3 (Result_N_e3_Telea.png)
  const radius = 3;

  const t0 = performance.now();
  const ours = inpaintTelea(input.pixels, input.width, input.height, mask, radius);
  const ms = performance.now() - t0;

  await saveRgbaAsPng(ours, input.width, input.height, join(OUTPUTS, `case${c.id}_ours.png`));
  await saveDiff(ours, reference.pixels, reference.width, reference.height, join(OUTPUTS, `case${c.id}_sidebyside.png`));

  const metrics = computeMetrics(ours, reference.pixels, mask, input.width, input.height);

  console.log(`  size: ${input.width}x${input.height}  mask: ${metrics.maskedPixelCount} px  time: ${ms.toFixed(0)} ms`);
  console.log(
    `  global : MAE ${metrics.maeGlobal.toFixed(2)}  PSNR ${metrics.psnrGlobal.toFixed(2)} dB`,
  );
  console.log(
    `  masked : MAE ${metrics.maeMasked.toFixed(2)}  PSNR ${metrics.psnrMasked.toFixed(2)} dB`,
  );

  return { ...metrics, ms, width: input.width, height: input.height };
}

async function main(): Promise<void> {
  await mkdir(FIXTURES, { recursive: true });
  await mkdir(OUTPUTS, { recursive: true });

  console.log('NukeBG Telea FMM — vs reference Python implementation');
  console.log('Reference: MilesWeberman/Image-Inpainting-Algorithm-Based-on-the-Fast-Marching-Method');
  console.log('Param: radius=3 (matches reference _e3_Telea variant)');

  const results: Array<Awaited<ReturnType<typeof runCase>>> = [];
  for (const c of CASES) {
    try {
      results.push(await runCase(c));
    } catch (e) {
      console.error(`  ✗ case ${c.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  if (results.length === 0) {
    console.error('\nNo cases completed.');
    process.exit(1);
  }

  console.log('\n─── Summary ───');
  console.log('PSNR interpretation (masked region only — this is what matters):');
  console.log('  >40 dB: visually indistinguishable');
  console.log('  30-40 dB: minor differences, acceptable');
  console.log('  20-30 dB: noticeable differences');
  console.log('  <20 dB: clear divergence, needs investigation\n');

  console.log('Case | Size       | Time    | Masked PSNR | Masked MAE | Global PSNR');
  console.log('-----|------------|---------|-------------|------------|------------');
  results.forEach((r, i) => {
    const c = CASES[i];
    console.log(
      `  ${c.id}  | ${String(r.width).padStart(4)}x${String(r.height).padEnd(4)} | ${r.ms.toFixed(0).padStart(5)} ms | ${r.psnrMasked.toFixed(2).padStart(8)} dB | ${r.maeMasked.toFixed(2).padStart(6)}    | ${r.psnrGlobal.toFixed(2).padStart(5)} dB`,
    );
  });

  const avgMasked = results.reduce((s, r) => s + r.psnrMasked, 0) / results.length;
  console.log(`\nAvg masked PSNR: ${avgMasked.toFixed(2)} dB`);
  console.log(`\nOutputs saved to: ${OUTPUTS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
