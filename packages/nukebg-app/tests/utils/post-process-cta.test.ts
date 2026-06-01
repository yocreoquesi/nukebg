import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectCta,
  recordSuccessfulNuke,
  pickCtaForCurrentState,
  dismissCta,
  _resetForTests,
  type CtaKey,
} from '../../src/utils/post-process-cta';

describe('post-process-cta — selectCta (pure)', () => {
  it('returns null for count 0 — no asking the first-time visitor', () => {
    expect(selectCta(0, new Set())).toBeNull();
  });

  it('returns null for negative count (defensive)', () => {
    expect(selectCta(-1, new Set())).toBeNull();
  });

  it('returns first-star at exactly count 1', () => {
    expect(selectCta(1, new Set())).toBe('first-star');
  });

  it('returns null between trigger counts', () => {
    expect(selectCta(2, new Set())).toBeNull();
    expect(selectCta(3, new Set())).toBeNull();
    expect(selectCta(4, new Set())).toBeNull();
  });

  it('returns five-tip at exactly count 5', () => {
    expect(selectCta(5, new Set())).toBe('five-tip');
  });

  it('returns ten-review at exactly count 10', () => {
    expect(selectCta(10, new Set())).toBe('ten-review');
  });

  it('skips a CTA that has been dismissed', () => {
    const dismissed = new Set<CtaKey>(['first-star']);
    expect(selectCta(1, dismissed)).toBeNull();
  });

  it('returns null for counts past the last trigger', () => {
    expect(selectCta(11, new Set())).toBeNull();
    expect(selectCta(100, new Set())).toBeNull();
  });
});

describe('post-process-cta — localStorage integration', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('recordSuccessfulNuke increments from 0 to 1 to 2 ...', () => {
    expect(recordSuccessfulNuke()).toBe(1);
    expect(recordSuccessfulNuke()).toBe(2);
    expect(recordSuccessfulNuke()).toBe(3);
  });

  it('pickCtaForCurrentState returns null at start', () => {
    expect(pickCtaForCurrentState()).toBeNull();
  });

  it('pickCtaForCurrentState returns first-star after first record', () => {
    recordSuccessfulNuke();
    expect(pickCtaForCurrentState()).toBe('first-star');
  });

  it('dismissCta persists, so the next pick returns null at the same count', () => {
    recordSuccessfulNuke();
    expect(pickCtaForCurrentState()).toBe('first-star');
    dismissCta('first-star');
    expect(pickCtaForCurrentState()).toBeNull();
  });

  it('dismiss is per-key — five-tip still fires after first-star dismissed', () => {
    // Simulate 5 nukes
    for (let i = 0; i < 5; i++) recordSuccessfulNuke();
    dismissCta('first-star');
    expect(pickCtaForCurrentState()).toBe('five-tip');
  });
});
