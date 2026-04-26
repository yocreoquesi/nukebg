/**
 * Reactor transparency page (#137). Renders the project's economics:
 * sunk cost (time + cash), forward burn, time breakdown, donors,
 * methodology. Toggled via hash route `#reactor` from main.ts.
 *
 * Pure consumer of the economics module (#136) and donors.json. No
 * business logic here, only DOM construction + i18n.
 */

import { t } from '../i18n';
import {
  SUNK,
  MONTHLY_BURN_EUR,
  TIME_BREAKDOWN,
  totalSunkEur,
  totalDonationsEur,
  computeRuntime,
  formatRuntime,
  donationToRuntimeDelta,
  type DonorsFile,
} from '../utils/reactor-economics';

const DONORS_URL = '/donors.json';

const EMPTY_DONORS: DonorsFile = {
  version: 1,
  updated_at: '',
  supporters: [],
  anonymous_count: 0,
  anonymous_total_eur: 0,
};

class ArReactor extends HTMLElement {
  private donors: DonorsFile = EMPTY_DONORS;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback(): Promise<void> {
    await this.loadDonors();
    this.render();
  }

  private async loadDonors(): Promise<void> {
    try {
      const res = await fetch(DONORS_URL, { cache: 'no-cache' });
      if (!res.ok) return;
      this.donors = (await res.json()) as DonorsFile;
    } catch {
      // Stay with EMPTY_DONORS — same shape, the page still renders
      // honestly with "0 months" + empty supporters table.
    }
  }

  private render(): void {
    const totalDonations = totalDonationsEur(this.donors);
    const { months, days } = computeRuntime(totalDonations);
    const monthsFloat = months + days / 30;
    const runtimeLabel = formatRuntime(monthsFloat);
    const burnLabel = `€${MONTHLY_BURN_EUR.toFixed(2)}/mo`;

    this.shadowRoot!.innerHTML = `
      <style>${this.styles()}</style>
      <article class="reactor">
        <header class="reactor-head">
          <a href="#" class="back-link" id="back-link" aria-label="${t('reactor.back')}">${t('reactor.back')}</a>
          <h1 class="reactor-title">$ cat /sys/reactor</h1>
        </header>

        <section class="block">
          <h2 class="block-title">── ${t('reactor.timeInvested')} ──</h2>
          <dl>
            <dt>${t('reactor.estimatedHours')}</dt><dd>~${SUNK.estimatedHours} h</dd>
            <dt>${t('reactor.fairRate')}</dt><dd>€${SUNK.hourlyRateEur}/h</dd>
            <dt>${t('reactor.timeValue')}</dt><dd>€${SUNK.estimatedHours * SUNK.hourlyRateEur}</dd>
          </dl>
        </section>

        <section class="block">
          <h2 class="block-title">── ${t('reactor.cashOutOfPocket')} ──</h2>
          <dl>
            <dt>${t('reactor.aiSubs')}</dt><dd>€180 (2 × €90)</dd>
            <dt>${t('reactor.domain')}</dt><dd>€15</dd>
            <dt>${t('reactor.cashSpent')}</dt><dd>€${SUNK.cashEur}</dd>
          </dl>
        </section>

        <section class="block totals">
          <h2 class="block-title">── ${t('reactor.totalSunk')} ──</h2>
          <p class="big-figure">€${totalSunkEur().toLocaleString('en-US')}</p>
          <p class="muted">${t('reactor.giftToCommunity')}</p>
        </section>

        <section class="block">
          <h2 class="block-title">── ${t('reactor.forwardBurn')} ──</h2>
          <dl>
            <dt>${t('reactor.aiAssistantMonthly')}</dt><dd>€90</dd>
            <dt>${t('reactor.domainAmortized')}</dt><dd>€1.25</dd>
            <dt>${t('reactor.burnRate')}</dt><dd>${burnLabel}</dd>
            <dt>${t('reactor.lifetimeDonations')}</dt><dd>€${totalDonations.toLocaleString('en-US')}</dd>
            <dt>${t('reactor.runtimeRemaining')}</dt><dd class="big-figure-small">${runtimeLabel}</dd>
          </dl>
        </section>

        <section class="block">
          <h2 class="block-title">── ${t('reactor.timeBreakdown')} ──</h2>
          <dl class="breakdown">
            ${TIME_BREAKDOWN.map(
              (b) =>
                `<dt>${t('reactor.cat.' + b.key)}</dt><dd><span class="hours">${b.hours} h</span> <span class="pct">(${b.percent}%)</span></dd>`,
            ).join('')}
          </dl>
        </section>

        <section class="block prose">
          <h2 class="block-title">── ${t('reactor.howItWorks')} ──</h2>
          <p>${t('reactor.howItWorksBody')}</p>
          <p>${t('reactor.donationLeverage')}</p>
          <ul class="leverage-list">
            <li><span class="amt">€5</span> → ${donationToRuntimeDelta(5)}</li>
            <li><span class="amt">€25</span> → ${donationToRuntimeDelta(25)}</li>
            <li><span class="amt">€90</span> → ${donationToRuntimeDelta(90)}</li>
          </ul>
        </section>

        <section class="block">
          <h2 class="block-title">── ${t('reactor.recentSupporters')} ──</h2>
          ${this.renderSupporters()}
          <a class="cta" href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener noreferrer">☕ ${t('reactor.tipCta')}</a>
        </section>

        <section class="block prose methodology" id="methodology">
          <h2 class="block-title">── ${t('reactor.methodology')} ──</h2>
          <p>${t('reactor.methodologyBody')}</p>
          <p class="muted">${t('reactor.removalNotice')}</p>
        </section>
      </article>
    `;

    const back = this.shadowRoot!.getElementById('back-link');
    back?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '';
    });
  }

  private renderSupporters(): string {
    const { supporters, anonymous_count, anonymous_total_eur } = this.donors;
    if (supporters.length === 0 && anonymous_count === 0) {
      return `<p class="muted">${t('reactor.noSupportersYet')}</p>`;
    }
    const rows = supporters
      .map(
        (s) =>
          `<tr><td class="sup-name">${escapeHtml(s.name)}</td><td class="sup-amt">€${s.amount_eur}</td><td class="sup-delta">${donationToRuntimeDelta(s.amount_eur)}</td></tr>`,
      )
      .join('');
    const anonRow =
      anonymous_count > 0
        ? `<p class="muted anon">${t('reactor.anonymousLine', {
            count: String(anonymous_count),
            total: `€${anonymous_total_eur}`,
          })}</p>`
        : '';
    return `
      <table class="supporters">
        <tbody>${rows}</tbody>
      </table>
      ${anonRow}
    `;
  }

  private styles(): string {
    return `
      :host {
        display: block;
        max-width: 760px;
        margin: 0 auto;
        padding: var(--space-6, 2rem) var(--space-4, 1rem);
        font-family: 'JetBrains Mono', monospace;
        color: var(--color-text-primary, #00ff41);
      }
      .reactor-head {
        margin-bottom: var(--space-5, 1.5rem);
      }
      .back-link {
        display: inline-block;
        font-size: 12px;
        color: var(--color-text-tertiary, #00b34a);
        text-decoration: none;
        margin-bottom: var(--space-3, 0.75rem);
      }
      .back-link::before { content: '← '; }
      .back-link:hover, .back-link:focus-visible {
        color: var(--color-accent-primary, #00ff41);
        text-decoration: underline;
      }
      .reactor-title {
        font-size: 18px;
        margin: 0;
        color: var(--color-accent-primary, #00ff41);
      }
      .block {
        margin-bottom: var(--space-5, 1.5rem);
        font-size: 13px;
      }
      .block-title {
        font-size: 13px;
        margin: 0 0 var(--space-2, 0.5rem) 0;
        color: var(--color-text-secondary, #00cc44);
        font-weight: 500;
        letter-spacing: 0.04em;
      }
      dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 16px;
        margin: 0;
      }
      dt {
        color: var(--color-text-secondary, #00cc44);
      }
      dd {
        margin: 0;
        text-align: right;
        color: var(--color-text-primary, #00ff41);
      }
      .breakdown dd {
        font-variant-numeric: tabular-nums;
      }
      .breakdown .hours { color: var(--color-text-primary, #00ff41); }
      .breakdown .pct { color: var(--color-text-tertiary, #00b34a); margin-left: 4px; }
      .totals { text-align: center; }
      .big-figure {
        font-size: 28px;
        margin: var(--space-3, 0.75rem) 0 4px;
        color: var(--color-accent-primary, #00ff41);
      }
      .big-figure-small {
        font-size: 16px;
        color: var(--color-accent-primary, #00ff41);
      }
      .muted {
        color: var(--color-text-tertiary, #00b34a);
        font-size: 12px;
        margin: 0;
      }
      .prose p {
        margin: 0 0 var(--space-3, 0.75rem) 0;
        line-height: 1.5;
        color: var(--color-text-primary, #00ff41);
      }
      .leverage-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 4px;
      }
      .leverage-list .amt {
        display: inline-block;
        min-width: 48px;
        color: var(--color-accent-primary, #00ff41);
        font-weight: 500;
      }
      table.supporters {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: var(--space-3, 0.75rem);
        font-variant-numeric: tabular-nums;
      }
      table.supporters td {
        padding: 4px 8px;
        border-bottom: 1px dashed var(--color-surface-border, #1a3a1a);
      }
      .sup-name { color: var(--color-text-primary, #00ff41); }
      .sup-amt { text-align: right; color: var(--color-text-secondary, #00cc44); }
      .sup-delta { text-align: right; color: var(--color-text-tertiary, #00b34a); font-size: 12px; }
      .anon { margin-top: var(--space-2, 0.5rem); }
      .cta {
        display: inline-block;
        margin-top: var(--space-3, 0.75rem);
        padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
        border: 1px solid var(--color-accent-primary, #00ff41);
        color: var(--color-accent-primary, #00ff41);
        background: transparent;
        text-decoration: none;
        font-size: 13px;
        font-family: inherit;
      }
      .cta:hover, .cta:focus-visible {
        background: var(--color-accent-primary, #00ff41);
        color: var(--color-bg, #000);
      }
      .methodology p { font-size: 12px; }

      @media (max-width: 480px) {
        .big-figure { font-size: 22px; }
        .reactor-title { font-size: 16px; }
      }
    `;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

customElements.define('ar-reactor', ArReactor);
