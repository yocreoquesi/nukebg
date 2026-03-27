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
          color: var(--color-text-secondary, #00cc33);
          cursor: pointer;
          position: relative;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .badge:active {
          border-color: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 8px var(--color-accent-glow, rgba(0,255,65,0.3));
        }
        .dare-msg {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: #000;
          border: 1px solid var(--color-accent-primary, #00ff41);
          padding: 0.5rem 0.75rem;
          font-size: 10px;
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          z-index: 50;
          box-shadow: 0 0 12px var(--color-accent-glow, rgba(0,255,65,0.3));
        }
        .dare-msg.visible {
          display: block;
        }
        /* tooltip on hover disabled — only click easter eggs */
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
          color: var(--color-text-secondary, #00cc33);
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
      <span class="badge" id="privacy-badge">
        <span id="privacy-badge-text">${t('privacy.badge')}</span>
        <span class="tooltip">
          <span id="privacy-line1">${t('privacy.tooltip.line1')}</span><br>
          <span id="privacy-line2">${t('privacy.tooltip.line2')}</span><br>
          <span id="privacy-line3">${t('privacy.tooltip.line3')}</span>
        </span>
        <span class="dare-msg" id="dare-msg"></span>
      </span>
    `;

    // Easter egg: click cycles through dare messages
    const dares = [
      "> Don't trust us? DevTools → Network tab. Zero requests. We dare you.",
      "> Go ahead, check. We'll wait.",
      "> Still here? Open the source code. GPL-3.0. Read every line.",
      "> Your pixels. Your device. Our code. Verified.",
      "> Other tools upload your images. We don't even know you exist.",
    ];
    let dareIndex = 0;
    const badge = this.shadowRoot!.querySelector('#privacy-badge');
    const dareMsg = this.shadowRoot!.querySelector('#dare-msg');
    badge?.addEventListener('click', () => {
      if (dareMsg) {
        dareMsg.textContent = dares[dareIndex % dares.length];
        dareMsg.classList.add('visible');
        dareIndex++;
        setTimeout(() => dareMsg.classList.remove('visible'), 3000);
      }
    });
  }
}

customElements.define('ar-privacy', ArPrivacy);
