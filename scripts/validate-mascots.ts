/**
 * Visual validation with synthetic mascot images.
 *
 * Generates synthetic images simulating different input types
 * (checkerboard, white background, black background, gray background)
 * with a colorful subject, processes them through the CV pipeline,
 * and verifies that each result has >20% foreground.
 *
 * Usage: npx tsx scripts/validate-mascots.ts
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const OUT_DIR = path.join(__dirname, '..', 'test-output', 'mascot-validation');

/** Crea una imagen solida */
function solidImage(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Crea una imagen checkerboard */
function checkerboardImage(
  w: number,
  h: number,
  gs: number,
  dark: [number, number, number],
  light: [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const cellRow = Math.floor(y / gs);
    for (let x = 0; x < w; x++) {
      const cellCol = Math.floor(x / gs);
      const parity = (cellRow + cellCol) % 2;
      const color = parity === 0 ? dark : light;
      const i = (y * w + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Pinta un rectangulo */
function paintRect(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

/** Pipeline CV completo */
function runCvPipeline(pixels: Uint8ClampedArray, width: number, height: number) {
  const bgInfo = detectBgColors(pixels, width, height);

  let bgMask: Uint8Array;
  let bgType: string;

  if (bgInfo.isCheckerboard) {
    bgType = 'checkerboard';
    const grid = detectCheckerGrid(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
    if (grid.gridSize > 0) {
      bgMask = gridFloodFill(
        pixels,
        width,
        height,
        bgInfo.colorA,
        bgInfo.colorB,
        grid.gridSize,
        grid.phase,
      );
      let bgCount = 0;
      for (let i = 0; i < bgMask.length; i++) if (bgMask[i]) bgCount++;
      const coverage = bgCount / (width * height);
      if (coverage < CV_PARAMS.LOW_COVERAGE_THRESHOLD) {
        const exclMask = subjectExclusion(
          pixels,
          width,
          height,
          bgInfo.colorA,
          bgInfo.colorB,
          grid.gridSize,
          grid.phase,
        );
        const floodMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
        bgMask = new Uint8Array(width * height);
        for (let i = 0; i < bgMask.length; i++) {
          bgMask[i] = exclMask[i] || floodMask[i] ? 1 : 0;
        }
      }
    } else {
      bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
    }
  } else if (bgInfo.cornerVariance < CV_PARAMS.SOLID_BG_VARIANCE) {
    bgType = 'solid';
    bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  } else {
    bgType = 'complex';
    bgMask = simpleFloodFill(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  }

  const wm = watermarkDetect(pixels, width, height, bgInfo.colorA, bgInfo.colorB);
  if (wm.detected && wm.mask) {
    const newMask = new Uint8Array(width * height);
    for (let i = 0; i < newMask.length; i++) {
      newMask[i] = bgMask[i] || wm.mask[i] ? 1 : 0;
    }
    bgMask = newMask;
  }

  bgMask = shadowCleanup(pixels, width, height, bgMask);
  const alpha = alphaRefine(bgMask, width, height);

  let fgCount = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 128) fgCount++;
  }

  return { alpha, bgType, fgPercent: (fgCount / (width * height)) * 100 };
}

interface MascotDef {
  name: string;
  width: number;
  height: number;
  build: () => Uint8ClampedArray;
}

const mascots: MascotDef[] = [
  {
    name: 'mascot-cartoon-checker',
    width: 256,
    height: 256,
    build() {
      const p = checkerboardImage(256, 256, 16, [191, 191, 191], [255, 255, 255]);
      paintRect(p, 256, 80, 40, 96, 176, 220, 60, 60);
      paintRect(p, 256, 100, 50, 56, 40, 255, 200, 150);
      paintRect(p, 256, 100, 150, 56, 40, 60, 60, 200);
      return p;
    },
  },
  {
    name: 'mascot-geometric-white',
    width: 256,
    height: 256,
    build() {
      const p = solidImage(256, 256, 255, 255, 255);
      paintRect(p, 256, 60, 30, 136, 196, 50, 150, 200);
      paintRect(p, 256, 90, 50, 76, 76, 255, 200, 50);
      paintRect(p, 256, 100, 180, 56, 40, 50, 200, 50);
      return p;
    },
  },
  {
    name: 'mascot-realistic-black',
    width: 256,
    height: 256,
    build() {
      const p = solidImage(256, 256, 0, 0, 0);
      paintRect(p, 256, 70, 30, 116, 196, 180, 130, 90);
      paintRect(p, 256, 90, 40, 76, 76, 220, 180, 150);
      paintRect(p, 256, 70, 140, 116, 86, 50, 50, 150);
      return p;
    },
  },
  {
    name: 'mascot-pixel-checker',
    width: 128,
    height: 128,
    build() {
      const p = checkerboardImage(128, 128, 8, [191, 191, 191], [255, 255, 255]);
      paintRect(p, 128, 40, 16, 48, 96, 200, 80, 80);
      paintRect(p, 128, 48, 24, 32, 24, 255, 200, 160);
      return p;
    },
  },
  {
    name: 'mascot-icon-m-gray',
    width: 128,
    height: 128,
    build() {
      const p = solidImage(128, 128, 220, 220, 220);
      paintRect(p, 128, 20, 20, 88, 88, 30, 30, 150);
      paintRect(p, 128, 30, 30, 12, 68, 255, 255, 255);
      paintRect(p, 128, 86, 30, 12, 68, 255, 255, 255);
      paintRect(p, 128, 50, 55, 14, 15, 255, 255, 255);
      return p;
    },
  },
];

// Main
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

let allPassed = true;

for (const m of mascots) {
  const pixels = m.build();
  const t0 = performance.now();
  const { alpha, bgType, fgPercent } = runCvPipeline(pixels, m.width, m.height);
  const elapsed = performance.now() - t0;

  const passed = fgPercent > 20;
  const status = passed ? 'PASS' : 'FAIL';
  if (!passed) allPassed = false;

  console.log(
    `[${status}] ${m.name}: ${bgType}, ${fgPercent.toFixed(1)}% fg, ${elapsed.toFixed(0)}ms`,
  );

  // Guardar resultado como PNG
  const resultPixels = Buffer.alloc(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    resultPixels[i * 4] = pixels[i * 4];
    resultPixels[i * 4 + 1] = pixels[i * 4 + 1];
    resultPixels[i * 4 + 2] = pixels[i * 4 + 2];
    resultPixels[i * 4 + 3] = alpha[i];
  }

  await sharp(resultPixels, { raw: { width: m.width, height: m.height, channels: 4 } })
    .png()
    .toFile(path.join(OUT_DIR, `${m.name}.png`));
}

console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'} - Results in ${OUT_DIR}/`);
process.exit(allPassed ? 0 : 1);
