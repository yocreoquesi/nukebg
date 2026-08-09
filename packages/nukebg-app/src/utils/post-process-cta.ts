/**
 * Post-process CTA gating logic (#139). Pure state machine — no DOM,
 * no events. Given the current localStorage counters, returns which
 * CTA (if any) the UI should show right now.
 *
 * Counters live in localStorage:
 *   nukebg:successful-nukes           → integer count
 *   nukebg:cta-dismissed              → JSON array of CTA keys already dismissed
 *
 * Show rules (per spec):
 *   nuke #1   → first-star    (GitHub star ask)
 *   nuke #5   → five-tip      (donation ask, Ko-fi)
 *   nuke #10  → ten-review    (community review ask)
 *
 * Each CTA shows AT MOST ONCE per user. Acting on it (click) marks it
 * dismissed too. The first visit (count = 0) never shows anything.
 */

const COUNTER_KEY = 'nukebg:successful-nukes';
const DISMISSED_KEY = 'nukebg:cta-dismissed';

export type CtaKey = 'first-star' | 'five-tip' | 'ten-review';

interface CtaRule {
  key: CtaKey;
  triggerCount: number;
}

const RULES: readonly CtaRule[] = [
  { key: 'first-star', triggerCount: 1 },
  { key: 'five-tip', triggerCount: 5 },
  { key: 'ten-review', triggerCount: 10 },
] as const;

function safeParseDismissed(): Set<CtaKey> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((s): s is CtaKey => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

function safeReadCount(): number {
  try {
    const raw = localStorage.getItem(COUNTER_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Increment the successful-nuke counter and return the new value.
 * Caller (the success path in ar-app) calls this once per finished
 * pipeline. Storage failures are silent — better to skip a tick than
 * to crash the post-process flow.
 */
export function recordSuccessfulNuke(): number {
  const next = safeReadCount() + 1;
  try {
    localStorage.setItem(COUNTER_KEY, String(next));
  } catch {
    // ignore — quota / disabled storage is fine
  }
  return next;
}

/**
 * Returns the CTA key to show RIGHT NOW given the counter and dismiss
 * state, or null if nothing should appear. Pure: same input, same
 * output, no side effects.
 */
export function selectCta(count: number, dismissed: Set<CtaKey>): CtaKey | null {
  if (count <= 0) return null;
  // Find the rule with the largest triggerCount <= current count that
  // hasn't been dismissed yet. This means a user that nukes 11 images
  // straight without dismissing still sees them in order on the
  // appropriate trigger nuke (1, 5, 10) — not a backlog of three at
  // once.
  for (const rule of RULES) {
    if (count === rule.triggerCount && !dismissed.has(rule.key)) {
      return rule.key;
    }
  }
  return null;
}

/** Convenience that pulls counters from localStorage and selects. */
export function pickCtaForCurrentState(): CtaKey | null {
  return selectCta(safeReadCount(), safeParseDismissed());
}

/** Mark a CTA as dismissed so it never shows again. */
export function dismissCta(key: CtaKey): void {
  const set = safeParseDismissed();
  set.add(key);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

/** Test-only escape hatch to reset state. Not exported in production. */
export function _resetForTests(): void {
  try {
    localStorage.removeItem(COUNTER_KEY);
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // ignore
  }
}
