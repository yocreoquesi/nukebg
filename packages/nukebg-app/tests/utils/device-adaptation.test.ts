import { describe, it, expect } from 'vitest';
import { getPrecisionForTier } from '../../src/utils/device-adaptation';
import type { CapabilityTier } from '../../src/utils/capability-detector';

describe('getPrecisionForTier', () => {
  it('low tier steps down to normal (single spatial pass, smaller intermediates)', () => {
    expect(getPrecisionForTier('low')).toBe('normal');
  });

  it.each(['mid', 'high', 'ultra'] as CapabilityTier[])(
    '%s keeps the empirically tuned high-power default',
    (tier) => {
      expect(getPrecisionForTier(tier)).toBe('high-power');
    },
  );

  it('never auto-selects full-nuke — that is an opt-in quality point, not a free upgrade', () => {
    const tiers: CapabilityTier[] = ['low', 'mid', 'high', 'ultra'];
    for (const t of tiers) {
      expect(getPrecisionForTier(t)).not.toBe('full-nuke');
    }
  });
});
