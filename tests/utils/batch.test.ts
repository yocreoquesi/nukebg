import { describe, it, expect, afterEach } from 'vitest';
import { getBatchLimit, BATCH_LIMITS } from '../../src/types/batch';

describe('getBatchLimit', () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalWidth,
    });
  });

  it('returns DESKTOP cap on wide viewports', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    expect(getBatchLimit()).toBe(BATCH_LIMITS.DESKTOP);
    expect(getBatchLimit()).toBe(12);
  });

  it('returns MOBILE cap below breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    expect(getBatchLimit()).toBe(BATCH_LIMITS.MOBILE);
    expect(getBatchLimit()).toBe(6);
  });

  it('uses desktop cap exactly at breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: BATCH_LIMITS.MOBILE_BREAKPOINT,
    });
    expect(getBatchLimit()).toBe(BATCH_LIMITS.DESKTOP);
  });
});
