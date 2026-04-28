import { describe, it, expect } from 'vitest';
import {
  SUNK,
  MONTHLY_BURN_EUR,
  TIME_BREAKDOWN,
  totalSunkEur,
  totalDonationsEur,
  computeRuntime,
  formatRuntime,
  donationToRuntimeDelta,
  isDonorsFile,
  type DonorsFile,
} from '../../src/utils/reactor-economics';

describe('reactor-economics — isDonorsFile (#188)', () => {
  const valid: DonorsFile = {
    version: 1,
    updated_at: '2026-04-28',
    supporters: [{ name: 'Alice', amount_eur: 25, date: '2026-04-01', consent: 'explicit' }],
    anonymous_count: 3,
    anonymous_total_eur: 9,
  };

  it('accepts a fully-formed file', () => {
    expect(isDonorsFile(valid)).toBe(true);
  });

  it('accepts an empty supporters array', () => {
    expect(isDonorsFile({ ...valid, supporters: [] })).toBe(true);
  });

  it.each([null, undefined, 42, 'string', []])('rejects non-object payload (%p)', (v) => {
    expect(isDonorsFile(v)).toBe(false);
  });

  it.each([
    ['missing version', { ...valid, version: undefined }],
    ['wrong version sentinel', { ...valid, version: 2 }],
    ['missing updated_at', { ...valid, updated_at: undefined }],
    ['updated_at not a string', { ...valid, updated_at: 12345 }],
    ['anonymous_count not a number', { ...valid, anonymous_count: '3' }],
    ['anonymous_total_eur not a number', { ...valid, anonymous_total_eur: null }],
    ['supporters not an array', { ...valid, supporters: 'oops' }],
  ])('rejects payload with %s', (_label, payload) => {
    expect(isDonorsFile(payload)).toBe(false);
  });

  it.each([
    ['missing name', [{ amount_eur: 1, date: 'x', consent: 'explicit' }]],
    ['amount_eur not a number', [{ name: 'A', amount_eur: '1', date: 'x', consent: 'explicit' }]],
    ['date not a string', [{ name: 'A', amount_eur: 1, date: 0, consent: 'explicit' }]],
    ['consent not "explicit"', [{ name: 'A', amount_eur: 1, date: 'x', consent: 'maybe' }]],
    ['supporter is not an object', [42]],
  ])('rejects malformed supporter entry (%s)', (_label, supporters) => {
    expect(isDonorsFile({ ...valid, supporters })).toBe(false);
  });
});

describe('reactor-economics — constants', () => {
  it('TIME_BREAKDOWN percents sum to 100', () => {
    const total = TIME_BREAKDOWN.reduce((acc, b) => acc + b.percent, 0);
    expect(total).toBe(100);
  });

  it('TIME_BREAKDOWN hours sum matches SUNK.estimatedHours', () => {
    const total = TIME_BREAKDOWN.reduce((acc, b) => acc + b.hours, 0);
    expect(total).toBe(SUNK.estimatedHours);
  });

  it('SUNK.hourlyRateEur is conservative for Spain (≤ €25/h)', () => {
    expect(SUNK.hourlyRateEur).toBeLessThanOrEqual(25);
  });

  it('MONTHLY_BURN_EUR matches the documented breakdown (€90 AI + €1.25 domain)', () => {
    expect(MONTHLY_BURN_EUR).toBe(91.25);
  });
});

describe('reactor-economics — totalSunkEur', () => {
  it('combines time value and cash spent', () => {
    expect(totalSunkEur()).toBe(SUNK.estimatedHours * SUNK.hourlyRateEur + SUNK.cashEur);
  });

  it('matches the documented €1,995 figure with current constants', () => {
    expect(totalSunkEur()).toBe(1995);
  });
});

describe('reactor-economics — totalDonationsEur', () => {
  const empty: DonorsFile = {
    version: 1,
    updated_at: '2026-04-26',
    supporters: [],
    anonymous_count: 0,
    anonymous_total_eur: 0,
  };

  it('returns 0 for an empty donors file', () => {
    expect(totalDonationsEur(empty)).toBe(0);
  });

  it('sums explicit supporter amounts', () => {
    const file: DonorsFile = {
      ...empty,
      supporters: [
        { name: 'a', amount_eur: 25, date: '2026-04-20', consent: 'explicit' },
        { name: 'b', amount_eur: 15, date: '2026-04-21', consent: 'explicit' },
      ],
    };
    expect(totalDonationsEur(file)).toBe(40);
  });

  it('includes the anonymous bucket', () => {
    const file: DonorsFile = {
      ...empty,
      supporters: [{ name: 'a', amount_eur: 10, date: '2026-04-20', consent: 'explicit' }],
      anonymous_count: 3,
      anonymous_total_eur: 30,
    };
    expect(totalDonationsEur(file)).toBe(40);
  });
});

describe('reactor-economics — computeRuntime', () => {
  it('returns 0/0 for zero donations (no fake runway)', () => {
    expect(computeRuntime(0)).toEqual({ months: 0, days: 0 });
  });

  it('returns 0/0 for negative input (defensive)', () => {
    expect(computeRuntime(-50)).toEqual({ months: 0, days: 0 });
  });

  it('returns 1 month for exactly one burn unit', () => {
    expect(computeRuntime(MONTHLY_BURN_EUR)).toEqual({ months: 1, days: 0 });
  });

  it('returns months + leftover days for partial second month', () => {
    // 1.5 burn units = 1 month + 15 days
    const result = computeRuntime(MONTHLY_BURN_EUR * 1.5);
    expect(result.months).toBe(1);
    expect(result.days).toBe(15);
  });

  it('handles small donations as 0 months + some days', () => {
    // €5 = 5/91.25 ≈ 0.0548 months ≈ 1.6 days
    const result = computeRuntime(5);
    expect(result.months).toBe(0);
    expect(result.days).toBe(1);
  });

  it('handles a large donation correctly (12 months)', () => {
    expect(computeRuntime(MONTHLY_BURN_EUR * 12)).toEqual({ months: 12, days: 0 });
  });
});

describe('reactor-economics — formatRuntime', () => {
  it('shows 0 months for zero or negative input', () => {
    expect(formatRuntime(0)).toBe('0 months');
    expect(formatRuntime(-5)).toBe('0 months');
  });

  it('shows one decimal for fractional months', () => {
    expect(formatRuntime(3.84)).toBe('3.8 months');
    expect(formatRuntime(0.55)).toBe('0.6 months');
  });

  it('always uses "months" plural — terminal aesthetic, no special case', () => {
    expect(formatRuntime(1)).toBe('1.0 months');
  });
});

describe('reactor-economics — donationToRuntimeDelta', () => {
  it('returns +0 for zero or negative donations', () => {
    expect(donationToRuntimeDelta(0)).toBe('+0');
    expect(donationToRuntimeDelta(-10)).toBe('+0');
  });

  it('expresses tiny donations in hours', () => {
    // €1 = 1/91.25 months ≈ 0.33 days ≈ 8 hours
    expect(donationToRuntimeDelta(1)).toMatch(/^\+\d+ hours?$/);
  });

  it('expresses small donations in days (between 1 and 30)', () => {
    // €5 = ≈ 1.6 days
    expect(donationToRuntimeDelta(5)).toBe('+1.6 days');
    // €25 = ≈ 8.2 days
    expect(donationToRuntimeDelta(25)).toBe('+8.2 days');
  });

  it('expresses large donations in months (>= 30 days)', () => {
    // €91.25 = exactly 1 month
    expect(donationToRuntimeDelta(MONTHLY_BURN_EUR)).toBe('+1.0 months');
    // €273.75 = 3 months
    expect(donationToRuntimeDelta(MONTHLY_BURN_EUR * 3)).toBe('+3.0 months');
  });

  it('singular vs plural hours', () => {
    // Find an amount that gives exactly 1 hour
    // 1 hour = 1/24 days = 1/(24*30) months = MONTHLY_BURN_EUR / 720
    const oneHourEur = MONTHLY_BURN_EUR / 720;
    expect(donationToRuntimeDelta(oneHourEur)).toBe('+1 hour');
  });
});
