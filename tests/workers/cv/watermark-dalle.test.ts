import { describe, it, expect } from 'vitest';
import { watermarkDetectDalle } from '../../../src/workers/cv/watermark-dalle';
import { DALLE_WATERMARK_PARAMS } from '../../../src/pipeline/constants';

/**
 * Behavioural tests for watermarkDetectDalle (#195).
 *
 * The detector scans the bottom-right corner for a horizontal stripe with
 * high color variance — the multicolor DALL-E 3 signature bar. Tests
 * cover the four gates the algorithm uses:
 *   1. minUniqueColors  — at least N quantized colors per scan row
 *   2. contrastThreshold — bar row has > 2× more colors than reference row
 *   3. minChannelSpread — bar row has > 200 R+G+B range
 *   4. mask geometry — covers detected band + MASK_MARGIN pixels
 */

const W = 300;
const H = 40;

function blankImage(rgb: [number, number, number] = [255, 255, 255]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = rgb[0];
    out[i * 4 + 1] = rgb[1];
    out[i * 4 + 2] = rgb[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Paint a horizontal multicolor stripe across rows [yStart, yEnd] in the
 *  rightmost 100 px (>= scanW for W=300). Uses 16 distinct hues so the
 *  quantized-color count clears MIN_UNIQUE_COLORS=15 with margin, and
 *  spans full RGB range so MIN_CHANNEL_SPREAD=200 is satisfied. */
function paintWatermarkStripe(pixels: Uint8ClampedArray, yStart: number, yEnd: number): void {
  const xStart = W - 100;
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x < W; x++) {
      const i = (y * W + x) * 4;
      // Cycle through 16 distinct hues by stepping x in groups.
      const hueIdx = ((x - xStart) >> 2) & 0x0f;
      pixels[i] = (hueIdx * 17) & 0xff; // 0, 17, 34, ..., 255
      pixels[i + 1] = (hueIdx * 23 + 50) & 0xff;
      pixels[i + 2] = (hueIdx * 31 + 100) & 0xff;
      pixels[i + 3] = 255;
    }
  }
}

describe('watermarkDetectDalle', () => {
  it('returns detected=false on a solid-color image', () => {
    const out = watermarkDetectDalle(blankImage([200, 100, 50]), W, H);
    expect(out.detected).toBe(false);
    expect(out.mask).toBeNull();
  });

  it('returns detected=false on a low-variance grayscale gradient', () => {
    // Smooth horizontal gradient: 256 distinct values total but quantized
    // to 16 brightness levels — well below MIN_UNIQUE_COLORS=15 *across
    // RGB combinations* in any 100-px slice (gradient is monotonic).
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.floor((x / W) * 255);
        const i = (y * W + x) * 4;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    const out = watermarkDetectDalle(px, W, H);
    expect(out.detected).toBe(false);
    expect(out.mask).toBeNull();
  });

  it('detects a synthetic multicolor stripe in the bottom-right band', () => {
    const px = blankImage([255, 255, 255]);
    const yStart = H - DALLE_WATERMARK_PARAMS.SCAN_HEIGHT;
    const yEnd = H - 1;
    paintWatermarkStripe(px, yStart, yEnd);

    const out = watermarkDetectDalle(px, W, H);
    expect(out.detected).toBe(true);
    expect(out.mask).not.toBeNull();
    expect(out.centerX).toBeGreaterThan(W / 2);
    expect(out.centerY).toBeGreaterThan(H - DALLE_WATERMARK_PARAMS.SCAN_HEIGHT - 1);
  });

  it('mask covers the detected band plus MASK_MARGIN on each side', () => {
    const px = blankImage([255, 255, 255]);
    const yStart = H - DALLE_WATERMARK_PARAMS.SCAN_HEIGHT;
    const yEnd = H - 1;
    paintWatermarkStripe(px, yStart, yEnd);

    const out = watermarkDetectDalle(px, W, H);
    expect(out.detected).toBe(true);
    const mask = out.mask!;
    const margin = DALLE_WATERMARK_PARAMS.MASK_MARGIN;
    // Top edge: pixel at (xCenter, yStart - margin) should be in mask.
    const xCenter = out.centerX!;
    expect(mask[(yStart - margin) * W + xCenter]).toBe(1);
    // Bottom edge: last row inside the image is in the mask.
    expect(mask[(H - 1) * W + xCenter]).toBe(1);
    // Outside the mask region: a pixel well above the band is not.
    expect(mask[5 * W + xCenter]).toBe(0);
  });

  it('mask only covers the rightmost scanW + margin columns', () => {
    const px = blankImage([255, 255, 255]);
    paintWatermarkStripe(px, H - DALLE_WATERMARK_PARAMS.SCAN_HEIGHT, H - 1);
    const out = watermarkDetectDalle(px, W, H);
    expect(out.detected).toBe(true);
    const mask = out.mask!;
    // Pixel in the left third of the image is never masked.
    const yMiddle = H - 5;
    expect(mask[yMiddle * W + 10]).toBe(0);
    // Pixel in the rightmost stripe is masked.
    expect(mask[yMiddle * W + (W - 5)]).toBe(1);
  });

  it('handles narrow images by clamping scanW to floor(width / 3)', () => {
    const narrowW = 30;
    const narrowH = 40;
    const px = new Uint8ClampedArray(narrowW * narrowH * 4);
    for (let i = 0; i < narrowW * narrowH; i++) {
      px[i * 4] = 200;
      px[i * 4 + 1] = 200;
      px[i * 4 + 2] = 200;
      px[i * 4 + 3] = 255;
    }
    // A solid image — we just want to verify the detector doesn't blow
    // up when scanW gets clamped to width/3 = 10.
    expect(() => watermarkDetectDalle(px, narrowW, narrowH)).not.toThrow();
    const out = watermarkDetectDalle(px, narrowW, narrowH);
    expect(out.detected).toBe(false);
  });
});
