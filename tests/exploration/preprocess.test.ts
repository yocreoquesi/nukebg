import { describe, it, expect } from 'vitest';
import { preprocessImageNet } from '../../exploration/loaders/preprocess';
import { sigmoidResizeQuantize } from '../../exploration/loaders/postprocess';

describe('preprocessImageNet', () => {
  it('produces NCHW tensor with expected length', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    pixels.fill(128);
    const { tensor, targetSize } = preprocessImageNet(pixels, 4, 4, 32);
    expect(targetSize).toBe(32);
    expect(tensor.length).toBe(3 * 32 * 32);
  });

  it('applies ImageNet normalization to a mid-gray pixel', () => {
    const pixels = new Uint8ClampedArray(4);
    pixels[0] = 128; pixels[1] = 128; pixels[2] = 128; pixels[3] = 255;
    const { tensor } = preprocessImageNet(pixels, 1, 1, 1);
    // Channel 0: (128/255 - 0.485) / 0.229 ≈ 0.077
    expect(tensor[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 3);
    // Channel 1: (128/255 - 0.456) / 0.224 ≈ 0.204
    expect(tensor[1]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 3);
    // Channel 2: (128/255 - 0.406) / 0.225 ≈ 0.427
    expect(tensor[2]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 3);
  });

  it('packs channels in NCHW order (all R, then all G, then all B)', () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 255;
    }
    const { tensor } = preprocessImageNet(pixels, 2, 2, 2);
    // First 4 values = R plane, all positive (255/255 = 1, normalized)
    for (let i = 0; i < 4; i++) expect(tensor[i]).toBeGreaterThan(0);
    // Next 4 = G plane, all negative (0/255 below mean)
    for (let i = 4; i < 8; i++) expect(tensor[i]).toBeLessThan(0);
    // Next 4 = B plane, all negative too
    for (let i = 8; i < 12; i++) expect(tensor[i]).toBeLessThan(0);
  });
});

describe('sigmoidResizeQuantize', () => {
  it('maps large positive logits near 255', () => {
    const logits = new Float32Array([10, 10, 10, 10]);
    const alpha = sigmoidResizeQuantize(logits, 2, 2, 2);
    for (const v of alpha) expect(v).toBeGreaterThan(250);
  });

  it('maps large negative logits near 0', () => {
    const logits = new Float32Array([-10, -10, -10, -10]);
    const alpha = sigmoidResizeQuantize(logits, 2, 2, 2);
    for (const v of alpha) expect(v).toBeLessThan(5);
  });

  it('upscales low-res mask to the requested dimensions', () => {
    const logits = new Float32Array([5, -5, -5, 5]);
    const alpha = sigmoidResizeQuantize(logits, 2, 4, 4);
    expect(alpha.length).toBe(16);
    // Corners keep the source signs (sigmoid(±5) is near-saturated)
    expect(alpha[0]).toBeGreaterThan(200);
    expect(alpha[3]).toBeLessThan(55);
    expect(alpha[12]).toBeLessThan(55);
    expect(alpha[15]).toBeGreaterThan(200);
  });
});
