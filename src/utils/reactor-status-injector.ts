/**
 * Reactor status injector — fetches donors.json at boot, computes runtime
 * via the pure economics module, and updates the few DOM elements that
 * carry the live numbers (footer status line, marquee segment, Ko-fi
 * link aria-label).
 *
 * Pure separation: no economics math here, no UI math here. Just glue.
 *
 * Failure mode: if the fetch fails (offline, CDN hiccup) we leave the
 * placeholders alone. The placeholders themselves are honest defaults
 * ("0 months" — same as the no-donations state) so a failed fetch is
 * indistinguishable from "no donations yet" to the user. No UX surprise.
 */

import {
  computeRuntime,
  formatRuntime,
  totalDonationsEur,
  MONTHLY_BURN_EUR,
  isDonorsFile,
  type DonorsFile,
} from './reactor-economics';

const DONORS_URL = '/donors.json';

interface ReactorStatusStrings {
  /** Footer status line. Receives `{runtime}` as the runtime label. */
  footerStatus: (runtime: string) => string;
  /** Marquee segment. Receives `{runtime}` as the runtime label. */
  marqueeFunding: (runtime: string) => string;
  /** aria-label for the footer link to the /reactor page. Receives `{runtime}`. */
  reactorLinkAria: (runtime: string) => string;
}

export async function applyReactorStatus(strings: ReactorStatusStrings): Promise<void> {
  const runtimeLabel = await fetchAndComputeRuntime();
  applyDom(runtimeLabel, strings);
}

/**
 * Pure-ish: does the fetch + math, returns the human runtime label.
 * Returns "0 months" on any failure path (offline, malformed JSON, etc.)
 * so callers always have something safe to render.
 */
async function fetchAndComputeRuntime(): Promise<string> {
  try {
    const res = await fetch(DONORS_URL, { cache: 'no-cache' });
    if (!res.ok) return formatRuntime(0);
    const payload: unknown = await res.json();
    if (!isDonorsFile(payload)) return formatRuntime(0);
    const donors: DonorsFile = payload;
    const totalEur = totalDonationsEur(donors);
    const { months, days } = computeRuntime(totalEur);
    const monthsFloat = months + days / 30;
    return formatRuntime(monthsFloat);
  } catch {
    return formatRuntime(0);
  }
}

function applyDom(runtimeLabel: string, strings: ReactorStatusStrings): void {
  const footer = document.getElementById('footer-reactor-status');
  if (footer) footer.textContent = strings.footerStatus(runtimeLabel);

  // Marquee text — the marquee is a long string with our segment marked
  // by a sentinel placeholder (to avoid having to re-render the whole
  // animated span). Replace the placeholder with the live segment.
  document.querySelectorAll<HTMLSpanElement>('[data-marquee-runtime]').forEach((el) => {
    el.textContent = strings.marqueeFunding(runtimeLabel);
  });

  const reactorLink = document.getElementById('reactor-link');
  if (reactorLink) reactorLink.setAttribute('aria-label', strings.reactorLinkAria(runtimeLabel));
}

/** Exported for tests — the burn rate in human-readable form. */
export function formatBurnRate(): string {
  return `€${MONTHLY_BURN_EUR.toFixed(2).replace(/\.00$/, '')}/mo`;
}
