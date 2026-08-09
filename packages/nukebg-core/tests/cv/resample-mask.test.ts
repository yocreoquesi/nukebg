import { describe, it, expect } from 'vitest';
import { resampleMask } from '../../src/cv/resample-mask';

describe('resampleMask', () => {
  it('returns an exact copy for identity dims (independent buffer)', () => {
    const src = new Uint8Array([0, 64, 128, 255]);
    const out = resampleMask(src, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([0, 64, 128, 255]);
    // Must be a copy, not the same reference (caller may mutate).
    expect(out).not.toBe(src);
  });

  it('applies the -0.5 pixel-center offset when downscaling 4x4 -> 2x2', () => {
    // Gradient source: mask[r*4+c] = (r*4+c)*16  ->  0,16,...,240.
    const src = new Uint8Array(16);
    for (let i = 0; i < 16; i++) src[i] = i * 16;

    const out = resampleMask(src, 4, 4, 2, 2);
    expect(out.length).toBe(4);

    // Destination pixel (x=1, y=1) -> index 3.
    // WITH offset: fx = fy = 1*2 - 0.5 = 1.5 -> x0=1,x1=2,dx=0.5 (same for y).
    //   v00=src[5]=80, v10=src[6]=96, v01=src[9]=144, v11=src[10]=160
    //   top=88, bot=152 -> round(88 + (152-88)*0.5) = 120.
    // WITHOUT the offset it would be fx=2 -> x0=2,dx=0 -> src[10] = 160.
    // Asserting 120 (not 160) is what makes this a real guard for review #5.
    expect(out[3]).toBe(120);
  });

  it('resamples a 2x2 -> 4x4 upscale to the correct length', () => {
    const src = new Uint8Array([0, 100, 200, 255]);
    const out = resampleMask(src, 2, 2, 4, 4);
    expect(out.length).toBe(16);
  });
});
