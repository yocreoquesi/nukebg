/**
 * Post-process CTA banner (#139). Listens for `ar:nuke-success` on
 * the document, increments the success counter, picks the next CTA
 * via the gating module, and renders a small dismissible banner
 * below the result viewer.
 *
 * Lives in light DOM (added to index.html) so it can sit just under
 * the main app surface without fighting any shadow tree z-index.
 */

import { t } from '../i18n';
import {
  recordSuccessfulNuke,
  pickCtaForCurrentState,
  selectCta,
  dismissCta,
  type CtaKey,
} from '../utils/post-process-cta';

interface CtaCopyKeys {
  text: string;
  cta: string;
  href: string;
}

const COPY: Record<CtaKey, CtaCopyKeys> = {
  'first-star': {
    text: 'cta.firstStar.text',
    cta: 'cta.firstStar.cta',
    href: 'https://github.com/yocreoquesi/nukebg',
  },
  'five-tip': {
    text: 'cta.fiveTip.text',
    cta: 'cta.fiveTip.cta',
    href: 'https://ko-fi.com/yocreoquesi',
  },
  'ten-review': {
    text: 'cta.tenReview.text',
    cta: 'cta.tenReview.cta',
    href: 'https://github.com/yocreoquesi/nukebg/discussions',
  },
};

class ArPostCta extends HTMLElement {
  private currentKey: CtaKey | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    document.addEventListener('ar:nuke-success', this.onSuccess);
    this.render();
  }

  disconnectedCallback(): void {
    document.removeEventListener('ar:nuke-success', this.onSuccess);
  }

  private onSuccess = (): void => {
    const newCount = recordSuccessfulNuke();
    const dismissed = new Set<CtaKey>(); // selectCta will re-check via storage in the helper
    const picked = selectCta(
      newCount,
      dismissed.size === 0 ? this.dismissedFromStorage() : dismissed,
    );
    if (picked) {
      // Delay 1s so it doesn't feel pushy — let the result settle first
      setTimeout(() => this.show(picked), 1000);
    }
  };

  private dismissedFromStorage(): Set<CtaKey> {
    try {
      const raw = localStorage.getItem('nukebg:cta-dismissed');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(arr);
    } catch {
      return new Set();
    }
  }

  private show(key: CtaKey): void {
    this.currentKey = key;
    this.render();
  }

  private render(): void {
    if (!this.currentKey) {
      this.shadowRoot!.innerHTML = '';
      return;
    }
    const copy = COPY[this.currentKey];
    this.shadowRoot!.innerHTML = `
      <style>${this.styles()}</style>
      <div class="cta-bar" role="status" aria-live="polite">
        <span class="cta-text">${t(copy.text)}</span>
        <a class="cta-link" href="${copy.href}" target="_blank" rel="noopener noreferrer">${t(copy.cta)}</a>
        <button type="button" class="cta-dismiss" aria-label="${t('cta.dismiss')}">×</button>
      </div>
    `;
    const link = this.shadowRoot!.querySelector('.cta-link');
    const dismiss = this.shadowRoot!.querySelector('.cta-dismiss');
    link?.addEventListener('click', () => {
      if (this.currentKey) dismissCta(this.currentKey);
      this.hide();
    });
    dismiss?.addEventListener('click', () => {
      if (this.currentKey) dismissCta(this.currentKey);
      this.hide();
    });
  }

  private hide(): void {
    this.currentKey = null;
    this.render();
  }

  private styles(): string {
    return `
      :host {
        display: block;
        max-width: 760px;
        margin: var(--space-3, 0.75rem) auto 0;
        padding: 0 var(--space-3, 0.75rem);
      }
      .cta-bar {
        display: flex;
        align-items: center;
        gap: var(--space-3, 0.75rem);
        padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
        border: 1px dashed var(--color-accent-primary, #00ff41);
        background: rgba(0, 0, 0, 0.4);
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: var(--color-text-primary, #00ff41);
        animation: fade-in 0.4s ease-out;
      }
      .cta-text {
        flex: 1;
        line-height: 1.4;
      }
      .cta-link {
        color: var(--color-accent-primary, #00ff41);
        text-decoration: none;
        white-space: nowrap;
        font-weight: 500;
        padding: 4px 8px;
        border: 1px solid var(--color-accent-primary, #00ff41);
        transition: background 0.15s, color 0.15s;
      }
      .cta-link:hover, .cta-link:focus-visible {
        background: var(--color-accent-primary, #00ff41);
        color: var(--color-bg, #000);
      }
      .cta-dismiss {
        background: transparent;
        border: none;
        color: var(--color-text-tertiary, #00b34a);
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      }
      .cta-dismiss:hover, .cta-dismiss:focus-visible {
        color: var(--color-accent-primary, #00ff41);
      }
      @keyframes fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .cta-bar { animation: none; }
      }
      @media (max-width: 480px) {
        .cta-bar {
          flex-wrap: wrap;
          font-size: 11px;
        }
        .cta-link { width: 100%; text-align: center; }
      }
    `;
  }
}

// Initial check on first load — if the user reloaded the page right
// after a successful nuke, the counter is already incremented; we
// shouldn't double-increment, but we should show the matching CTA
// if they haven't seen it yet.
function maybeShowOnLoad(host: ArPostCta): void {
  const picked = pickCtaForCurrentState();
  if (picked) {
    setTimeout(() => {
      // Use the public API by setting a private field via the same
      // method the event handler does
      (host as unknown as { show: (k: CtaKey) => void }).show(picked);
    }, 1500);
  }
}

customElements.define('ar-post-cta', ArPostCta);

// Auto-trigger initial check on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('ar-post-cta') as ArPostCta | null;
    if (el) maybeShowOnLoad(el);
  });
} else {
  const el = document.querySelector('ar-post-cta') as ArPostCta | null;
  if (el) maybeShowOnLoad(el);
}
