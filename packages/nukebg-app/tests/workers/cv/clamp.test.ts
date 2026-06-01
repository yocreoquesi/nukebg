import { describe, it, expect } from 'vitest';
import { clamp255 } from '../../../src/workers/cv/clamp';

describe('clamp255 (#194)', () => {
  it('passes integers in range through unchanged', () => {
    expect(clamp255(0)).toBe(0);
    expect(clamp255(128)).toBe(128);
    expect(clamp255(255)).toBe(255);
  });

  it('rounds floats to nearest integer', () => {
    expect(clamp255(127.4)).toBe(127);
    expect(clamp255(127.6)).toBe(128);
    expect(clamp255(0.4)).toBe(0);
    expect(clamp255(0.6)).toBe(1);
  });

  it('clamps below 0 to 0', () => {
    expect(clamp255(-1)).toBe(0);
    expect(clamp255(-1000)).toBe(0);
    expect(clamp255(-Infinity)).toBe(0);
  });

  it('clamps above 255 to 255', () => {
    expect(clamp255(256)).toBe(255);
    expect(clamp255(1000)).toBe(255);
    expect(clamp255(Infinity)).toBe(255);
  });

  it('returns 0 for NaN (defensive — upstream math should not produce NaN)', () => {
    expect(clamp255(NaN)).toBe(0);
  });
});
