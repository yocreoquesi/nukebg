import { t } from '../i18n';

export class ArPrivacy extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.renderContent();
    document.addEventListener('nukebg:locale-changed', () => {
      this.updateTexts();
    });
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const badgeText = root.querySelector('#privacy-badge-text');
    if (badgeText) badgeText.textContent = t('privacy.badge');
    const line1 = root.querySelector('#privacy-line1');
    if (line1) line1.textContent = t('privacy.tooltip.line1');
    const line2 = root.querySelector('#privacy-line2');
    if (line2) line2.textContent = t('privacy.tooltip.line2');
    const line3 = root.querySelector('#privacy-line3');
    if (line3) line3.textContent = t('privacy.tooltip.line3');
  }

  private renderContent(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: inline-flex;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          background: #000;
          border: 1px solid #1a3a1a;
          border-radius: 0;
          padding: 0.25rem 0.75rem;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: var(--font-medium, 500);
          color: #00cc33;
          cursor: default;
          position: relative;
        }
        .badge:hover .tooltip {
          display: block;
        }
        .tooltip {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: #0a0a0a;
          border: 1px solid #1a3a1a;
          border-radius: 0;
          padding: 0.75rem;
          font-size: var(--text-xs, 0.75rem);
          color: #00cc33;
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          box-shadow: var(--shadow-md);
          z-index: var(--z-toast, 40);
          line-height: 1.5;
        }
        @media (max-width: 480px) {
          .tooltip {
            white-space: normal;
            max-width: 220px;
            font-size: 10px;
          }
        }
      </style>
      <span class="badge">
        <span id="privacy-badge-text">${t('privacy.badge')}</span>
        <span class="tooltip">
          <span id="privacy-line1">${t('privacy.tooltip.line1')}</span><br>
          <span id="privacy-line2">${t('privacy.tooltip.line2')}</span><br>
          <span id="privacy-line3">${t('privacy.tooltip.line3')}</span>
        </span>
      </span>
    `;
  }
}

customElements.define('ar-privacy', ArPrivacy);
