#!/usr/bin/env node
// One-off generator for the browser<->Node parity test fixture set
// (packages/nukebg-core/tests/fixtures/parity/, task 17.1).
//
// These are DETERMINISTIC SYNTHETIC placeholders, not real photographs —
// see the README.md committed alongside the generated files for why.
// Re-running this script regenerates byte-identical output (pure math,
// no randomness, no external assets).
//
// Usage: node packages/nukebg-cli/scripts/generate-parity-fixtures.mjs
// Requires `sharp` (a nukebg-cli dependency, hoisted to root node_modules
// in this workspace) — NOT a nukebg-core dependency.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../nukebg-core/tests/fixtures/parity');

/**
 * Build a raw RGBA buffer by evaluating `fill(x, y)` for every pixel.
 * `fill` must return `[r, g, b, a]` deterministically.
 */
function buildRgba(width, height, fill) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // ---------------------------------------------------------------------
  // portrait-512x512.png — "portrait" stand-in: a centered filled ellipse
  // (skin-tone-like solid color) on a solid white background. Exercises
  // the subject/background split the parity test cares about without
  // needing a licensed photograph.
  // ---------------------------------------------------------------------
  const PORTRAIT_W = 512;
  const PORTRAIT_H = 512;
  const portrait = buildRgba(PORTRAIT_W, PORTRAIT_H, (x, y) => {
    const cx = PORTRAIT_W / 2;
    const cy = PORTRAIT_H / 2 + 20;
    const rx = 140;
    const ry = 190;
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) return [222, 184, 135, 255]; // burlywood
    return [255, 255, 255, 255]; // white background
  });
  await sharp(portrait, { raw: { width: PORTRAIT_W, height: PORTRAIT_H, channels: 4 } })
    .png()
    .toFile(path.join(outDir, 'portrait-512x512.png'));

  // ---------------------------------------------------------------------
  // product-800x600.jpg — "product with watermark" stand-in: a centered
  // filled ellipse ("product body") on a light background, with a
  // repeating diagonal semi-transparent stripe pattern blended over the
  // whole frame ("watermark" stand-in). JPEG has no alpha channel, so the
  // watermark is baked into RGB via alpha blending at generation time.
  // ---------------------------------------------------------------------
  const PRODUCT_W = 800;
  const PRODUCT_H = 600;
  const product = buildRgba(PRODUCT_W, PRODUCT_H, (x, y) => {
    let r = 245;
    let g = 245;
    let b = 245;
    const cx = PRODUCT_W / 2;
    const cy = PRODUCT_H / 2;
    const rx = 220;
    const ry = 160;
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) {
      r = 180;
      g = 60;
      b = 60;
    }
    const isStripe = (x + y) % 40 < 6;
    if (isStripe) {
      const alpha = 0.35;
      r = Math.round(r * (1 - alpha) + 255 * alpha);
      g = Math.round(g * (1 - alpha) + 255 * alpha);
      b = Math.round(b * (1 - alpha) + 255 * alpha);
    }
    return [r, g, b, 255];
  });
  await sharp(product, { raw: { width: PRODUCT_W, height: PRODUCT_H, channels: 4 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(outDir, 'product-800x600.jpg'));

  // ---------------------------------------------------------------------
  // logo-256x256.png — "icon/logo with transparent background" stand-in:
  // a solid opaque circle on a fully transparent background.
  // ---------------------------------------------------------------------
  const LOGO_W = 256;
  const LOGO_H = 256;
  const logo = buildRgba(LOGO_W, LOGO_H, (x, y) => {
    const cx = LOGO_W / 2;
    const cy = LOGO_H / 2;
    const r = 90;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= r) return [30, 120, 200, 255]; // opaque blue circle
    return [0, 0, 0, 0]; // fully transparent
  });
  await sharp(logo, { raw: { width: LOGO_W, height: LOGO_H, channels: 4 } })
    .png()
    .toFile(path.join(outDir, 'logo-256x256.png'));

  // eslint-disable-next-line no-console
  console.log(`Parity fixtures written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
