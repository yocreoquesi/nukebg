import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeTargetSize,
  detectCapability,
  __resetCapabilityCache,
  ABSOLUTE_MAX_PIXELS,
} from '../../src/utils/capability-detector';

describe('computeTargetSize', () => {
  const cap = {
    maxPixels: 16_000_000,
    maxDimension: 4_096,
    tier: 'mid' as const,
    reason: 'test',
  };

  it('returns original size when image fits', () => {
    const r = computeTargetSize(1920, 1080, cap);
    expect(r.needsDownscale).toBe(false);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.scale).toBe(1);
  });

  it('scales down by max dimension when side exceeds maxDimension', () => {
    const r = computeTargetSize(8000, 4000, cap);
    expect(r.needsDownscale).toBe(true);
    expect(Math.max(r.width, r.height)).toBe(4096);
    expect(r.scale).toBeCloseTo(4096 / 8000, 3);
  });

  it('scales down by pixel budget when area exceeds maxPixels', () => {
    // 6000x3000 = 18M pixels > 16M budget, longest side 6000 > 4096.
    // The dimension bound drives the scale here.
    const r = computeTargetSize(6000, 3000, cap);
    expect(r.needsDownscale).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(cap.maxPixels);
  });

  it('preserves aspect ratio', () => {
    const r = computeTargetSize(9000, 6000, cap);
    const origRatio = 9000 / 6000;
    const newRatio = r.width / r.height;
    expect(newRatio).toBeCloseTo(origRatio, 2);
  });

  it('handles square images', () => {
    const r = computeTargetSize(8192, 8192, cap);
    expect(r.width).toBe(r.height);
    expect(r.width).toBeLessThanOrEqual(4096);
  });

  it('respects pixel budget on near-square images', () => {
    // 5000x5000 = 25M pixels. Fits the dim bound (4096 > longest needed)
    // but exceeds the 16M pixel budget. Must scale by pixel bound.
    const highDimCap = { ...cap, maxDimension: 10_000 };
    const r = computeTargetSize(5000, 5000, highDimCap);
    expect(r.needsDownscale).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(cap.maxPixels + 100);
  });
});

describe('detectCapability', () => {
  beforeEach(() => {
    __resetCapabilityCache();
  });

  it('returns a tier with positive bounds', () => {
    const cap = detectCapability();
    expect(cap.maxPixels).toBeGreaterThan(0);
    expect(cap.maxDimension).toBeGreaterThan(0);
    expect(['low', 'mid', 'high', 'ultra']).toContain(cap.tier);
  });

  it('stays within the absolute ceiling', () => {
    const cap = detectCapability();
    expect(cap.maxPixels).toBeLessThanOrEqual(ABSOLUTE_MAX_PIXELS);
  });

  it('provides a human-readable reason string', () => {
    const cap = detectCapability();
    expect(cap.reason.length).toBeGreaterThan(0);
  });
});
