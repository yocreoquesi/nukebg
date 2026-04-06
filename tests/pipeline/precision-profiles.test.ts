import { describe, it, expect } from 'vitest';
import {
  PRECISION_PROFILES,
  REFINE_PARAMS,
} from '../../src/pipeline/constants';
import type { PrecisionMode, PrecisionProfile } from '../../src/pipeline/constants';

describe('PrecisionProfiles', () => {
  const modes: PrecisionMode[] = ['low-power', 'normal', 'high-power', 'full-nuke'];

  it('defines all four precision modes', () => {
    for (const mode of modes) {
      expect(PRECISION_PROFILES[mode]).toBeDefined();
    }
  });

  it('each profile has all required fields', () => {
    const requiredKeys: (keyof PrecisionProfile)[] = [
      'rmbgThreshold',
      'spatialPasses',
      'spatialRadius',
      'morphOpenRadius',
      'clusterRatio',
      'minClusterSize',
    ];

    for (const mode of modes) {
      const profile = PRECISION_PROFILES[mode];
      for (const key of requiredKeys) {
        expect(profile[key], `${mode}.${key}`).toBeDefined();
        expect(typeof profile[key], `${mode}.${key} type`).toBe('number');
      }
    }
  });

  it('normal mode matches REFINE_PARAMS defaults', () => {
    const normal = PRECISION_PROFILES['normal'];
    expect(normal.spatialRadius).toBe(REFINE_PARAMS.SPATIAL_RADIUS);
    expect(normal.morphOpenRadius).toBe(REFINE_PARAMS.MORPH_OPEN_RADIUS);
    expect(normal.clusterRatio).toBe(REFINE_PARAMS.CLUSTER_RATIO);
    expect(normal.minClusterSize).toBe(REFINE_PARAMS.MIN_CLUSTER_SIZE);
  });

  it('rmbg threshold decreases as precision increases', () => {
    const thresholds = modes.map(m => PRECISION_PROFILES[m].rmbgThreshold);
    // low-power > normal > high-power > full-nuke
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i], `${modes[i]} threshold < ${modes[i-1]} threshold`)
        .toBeLessThan(thresholds[i - 1]);
    }
  });

  it('spatial passes increase as precision increases', () => {
    const passes = modes.map(m => PRECISION_PROFILES[m].spatialPasses);
    // Each mode should have >= the passes of the previous mode
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i], `${modes[i]} passes >= ${modes[i-1]} passes`)
        .toBeGreaterThanOrEqual(passes[i - 1]);
    }
  });

  it('cluster ratio decreases as precision increases (keeps more detail)', () => {
    const ratios = modes.map(m => PRECISION_PROFILES[m].clusterRatio);
    // low-power has the most aggressive cleanup (higher ratio)
    // full-nuke keeps the most detail (lower ratio)
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${modes[i]} ratio <= ${modes[i-1]} ratio`)
        .toBeLessThanOrEqual(ratios[i - 1]);
    }
  });

  it('min cluster size decreases as precision increases (keeps smaller clusters)', () => {
    const sizes = modes.map(m => PRECISION_PROFILES[m].minClusterSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `${modes[i]} minCluster <= ${modes[i-1]} minCluster`)
        .toBeLessThanOrEqual(sizes[i - 1]);
    }
  });

  it('all thresholds are in valid RMBG range (0-1)', () => {
    for (const mode of modes) {
      const t = PRECISION_PROFILES[mode].rmbgThreshold;
      expect(t, `${mode} threshold`).toBeGreaterThan(0);
      expect(t, `${mode} threshold`).toBeLessThanOrEqual(1);
    }
  });

  it('low-power skips morphological opening', () => {
    expect(PRECISION_PROFILES['low-power'].morphOpenRadius).toBe(0);
  });

  it('full-nuke has the most aggressive morphological opening', () => {
    const radii = modes.map(m => PRECISION_PROFILES[m].morphOpenRadius);
    expect(radii[3]).toBeGreaterThanOrEqual(radii[0]);
    expect(radii[3]).toBeGreaterThanOrEqual(radii[1]);
    expect(radii[3]).toBeGreaterThanOrEqual(radii[2]);
  });
});
