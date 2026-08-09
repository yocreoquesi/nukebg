/**
 * Reactor economics — pure computation layer for the funding transparency
 * page (issue #137) and the post-process CTA rotation (issue #139).
 *
 * No DOM, no fetch, no side effects. All values are deliberately
 * conservative and the methodology is documented inline so the numbers
 * can be defended publicly without hand-waving.
 *
 * Background:
 *   The project is bootstrapped on an AI coding assistant subscription
 *   paid out of the maintainer's pocket. When that runs out, code
 *   shipping pauses. Donations directly extend the development runway,
 *   and this module turns euros into the time-units that humans
 *   actually feel.
 */

/**
 * Sunk investment to date. Time + cash that has already been spent.
 * Not recoverable; framed as "gift to the community" on the reactor page.
 *
 * Hours estimate methodology: 313 commits across 13 active days, weighted
 * by typical time-per-commit per category, +25% for research / debugging
 * / discarded explorations not visible in the commit log. Estimate
 * accuracy: roughly +/-15h.
 *
 * Hourly rate: 20 EUR/h is below the mid-market freelance rate in Spain
 * (which sits around 22-25 EUR/h for a mid developer in 2026).
 * Deliberately conservative so the number cannot be accused of inflation.
 */
export const SUNK = {
  estimatedHours: 90,
  hourlyRateEur: 20,
  cashEur: 195,
} as const;

/**
 * Forward burn — what it costs per month to keep code shipping. The
 * infrastructure (Cloudflare Pages free tier + cached models) keeps
 * the live app running for users at zero cost; this number is purely
 * the cost of continuing to ship updates / fixes / new features.
 */
export const MONTHLY_BURN_EUR = 91.25;

/**
 * Breakdown of the estimated hours by activity. Categories chosen to
 * answer the realistic question "where did the 90h go?". Percent values
 * sum to 100 (verified by tests).
 *
 * The fix: prefix in this codebase is overloaded — it covers genuine
 * regressions but also UX polish and build-compat patches. Hours have
 * been redistributed accordingly so the bug-fix bucket reflects only
 * real bug regressions.
 */
export const TIME_BREAKDOWN = [
  { key: 'features', hours: 30, percent: 33 },
  { key: 'design', hours: 16, percent: 18 },
  { key: 'research', hours: 15, percent: 17 },
  { key: 'bugfixes', hours: 12, percent: 13 },
  { key: 'refactor', hours: 10, percent: 11 },
  { key: 'tooling', hours: 5, percent: 6 },
  { key: 'tests', hours: 2, percent: 2 },
] as const;

export interface SupporterEntry {
  name: string;
  amount_eur: number;
  date: string;
  consent: 'explicit';
}

export interface DonorsFile {
  version: number;
  updated_at: string;
  supporters: SupporterEntry[];
  anonymous_count: number;
  anonymous_total_eur: number;
}

/**
 * Runtime shape guard for `/donors.json` payloads (#188). Cheap manual
 * check — no Zod dependency for one schema. Validates the version
 * sentinel, the four expected fields and (shallowly) the supporters
 * array entries so consumers can trust `donors.supporters[i].amount_eur`
 * without runtime surprises.
 *
 * Returns false (rather than throwing) so callers can fall back to an
 * empty donors object and keep the page rendering honestly.
 */
export function isDonorsFile(x: unknown): x is DonorsFile {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.updated_at !== 'string') return false;
  if (typeof o.anonymous_count !== 'number') return false;
  if (typeof o.anonymous_total_eur !== 'number') return false;
  if (!Array.isArray(o.supporters)) return false;
  for (const s of o.supporters) {
    if (typeof s !== 'object' || s === null) return false;
    const e = s as Record<string, unknown>;
    if (typeof e.name !== 'string') return false;
    if (typeof e.amount_eur !== 'number') return false;
    if (typeof e.date !== 'string') return false;
    if (e.consent !== 'explicit') return false;
  }
  return true;
}

/**
 * Total sunk investment in EUR (time at fair-rate + cash spent).
 */
export function totalSunkEur(): number {
  return SUNK.estimatedHours * SUNK.hourlyRateEur + SUNK.cashEur;
}

/**
 * Lifetime donations from the donors file: explicit supporters' amounts
 * plus the anonymous bucket total.
 */
export function totalDonationsEur(donors: DonorsFile): number {
  const explicit = donors.supporters.reduce((acc, s) => acc + s.amount_eur, 0);
  return explicit + donors.anonymous_total_eur;
}

/**
 * How long the current donation balance can fund development at the
 * current monthly burn rate. Returns months as a float and days as an
 * integer (days = floor of the leftover after whole months).
 *
 * Returns 0/0 if donations are zero — code shipping is currently
 * funded by the maintainer's pocket, not by donations, and the page
 * should show that honestly.
 */
export function computeRuntime(lifetimeDonationsEur: number): {
  months: number;
  days: number;
} {
  if (lifetimeDonationsEur <= 0) return { months: 0, days: 0 };
  const monthsFloat = lifetimeDonationsEur / MONTHLY_BURN_EUR;
  const wholeMonths = Math.floor(monthsFloat);
  const leftover = monthsFloat - wholeMonths;
  const days = Math.floor(leftover * 30);
  return { months: wholeMonths, days };
}

/**
 * Human-readable runtime: "0 months", "3.8 months", "1.0 month", etc.
 * Uses one decimal so small donations register as a visible delta on
 * the next render instead of disappearing into rounding.
 */
export function formatRuntime(monthsFloat: number): string {
  if (monthsFloat <= 0) return '0 months';
  const rounded = Math.round(monthsFloat * 10) / 10;
  return `${rounded.toFixed(1)} months`;
}

/**
 * What an incoming donation of `amountEur` adds to the runtime, framed
 * as the smallest unit that still feels concrete.
 *
 *   < 1 day    -> "+X hours"
 *   < 30 days  -> "+X days"
 *   >= 30 days -> "+X months"
 *
 * Keeps the conversion legible and tangible at every donation size.
 */
export function donationToRuntimeDelta(amountEur: number): string {
  if (amountEur <= 0) return '+0';
  const monthsFloat = amountEur / MONTHLY_BURN_EUR;
  const days = monthsFloat * 30;
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `+${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (days < 30) {
    const rounded = Math.round(days * 10) / 10;
    return `+${rounded.toFixed(1)} days`;
  }
  const months = Math.round(monthsFloat * 10) / 10;
  return `+${months.toFixed(1)} months`;
}
