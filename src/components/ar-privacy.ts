import { t } from '../i18n';

export class ArPrivacy extends HTMLElement {
  private boundLocaleHandler: (() => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.renderContent();
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  disconnectedCallback(): void {
    if (this.boundLocaleHandler)
      document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
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
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 0.25rem 0.75rem;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: var(--font-medium, 500);
          color: var(--color-text-secondary, #00dd44);
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
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-accent-primary, #00ff41);
          padding: 0.5rem 0.75rem;
          font-size: 12px;
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
          z-index: 50;
          box-shadow: 0 0 12px var(--color-accent-glow, rgba(0,255,65,0.3));
        }
        .dare-msg.visible {
          display: block;
        }
        /* tooltip on hover disabled - only click easter eggs */
        .tooltip {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--color-bg-secondary, #0a0a0a);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 0.75rem;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-secondary, #00dd44);
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
            font-size: 12px;
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

    // Easter egg: click cycles through dare messages (translated)
    const daresByLang: Record<string, string[]> = {
      en: [
        "> Don't trust us? DevTools > Network tab. Zero requests. We dare you.",
        "> Go ahead, check. We'll wait.",
        '> Still here? Open the source code. GPL-3.0. Read every line.',
        '> Your pixels. Your device. Our code. Verified.',
        "> Other tools upload your images. We don't even know you exist.",
      ],
      es: [
        '> No te fias? DevTools > pesta\u00F1a Red. Cero peticiones. Te retamos.',
        '> Venga, comprueba. Esperamos.',
        '> Sigues aqui? Abre el codigo fuente. GPL-3.0. Lee cada linea.',
        '> Tus pixeles. Tu dispositivo. Nuestro codigo. Verificado.',
        '> Otras herramientas suben tus imagenes. Nosotros ni sabemos que existes.',
      ],
      fr: [
        '> Tu nous fais pas confiance? DevTools > onglet R\u00E9seau. Z\u00E9ro requ\u00EAte. Chiche.',
        '> Vas-y, v\u00E9rifie. On attend.',
        '> Encore l\u00E0? Ouvre le code source. GPL-3.0. Lis chaque ligne.',
        '> Tes pixels. Ton appareil. Notre code. V\u00E9rifi\u00E9.',
        '> Les autres uploadent tes images. Nous, on sait m\u00EAme pas que tu existes.',
      ],
      de: [
        '> Vertraust du uns nicht? DevTools > Netzwerk-Tab. Null Anfragen. Trau dich.',
        '> Nur zu, pr\u00FCf nach. Wir warten.',
        '> Immer noch da? \u00D6ffne den Quellcode. GPL-3.0. Lies jede Zeile.',
        '> Deine Pixel. Dein Ger\u00E4t. Unser Code. Verifiziert.',
        '> Andere Tools laden deine Bilder hoch. Wir wissen nichtmal, dass du existierst.',
      ],
      pt: [
        '> N\u00E3o confia? DevTools > aba Rede. Zero requisi\u00E7\u00F5es. Te desafiamos.',
        '> Vai l\u00E1, confere. A gente espera.',
        '> Ainda aqui? Abre o c\u00F3digo fonte. GPL-3.0. L\u00EA cada linha.',
        '> Seus pixels. Seu dispositivo. Nosso c\u00F3digo. Verificado.',
        '> Outras ferramentas sobem suas imagens. A gente nem sabe que voc\u00EA existe.',
      ],
      zh: [
        '> \u4E0D\u4FE1\uFF1FDevTools > \u7F51\u7EDC\u9762\u677F\u3002\u96F6\u8BF7\u6C42\u3002\u4E0D\u4FE1\u4F60\u6765\u67E5\u3002',
        '> \u53BB\u5427\uFF0C\u67E5\u770B\u5427\u3002\u6211\u4EEC\u7B49\u3002',
        '> \u8FD8\u5728\uFF1F\u6253\u5F00\u6E90\u7801\u3002GPL-3.0\u3002\u6BCF\u884C\u90FD\u770B\u3002',
        '> \u4F60\u7684\u50CF\u7D20\u3002\u4F60\u7684\u8BBE\u5907\u3002\u6211\u4EEC\u7684\u4EE3\u7801\u3002\u5DF2\u9A8C\u8BC1\u3002',
        '> \u5176\u4ED6\u5DE5\u5177\u4F1A\u4E0A\u4F20\u4F60\u7684\u56FE\u7247\u3002\u6211\u4EEC\u8FDE\u4F60\u662F\u8C01\u90FD\u4E0D\u77E5\u9053\u3002',
      ],
    };
    let dareIndex = 0;
    let dareTimer: ReturnType<typeof setTimeout> | null = null;
    const DARE_DURATION = 4000; // consistent read time for all messages
    const badge = this.shadowRoot!.querySelector('#privacy-badge');
    const dareMsg = this.shadowRoot!.querySelector('#dare-msg');
    badge?.addEventListener('click', () => {
      if (!dareMsg) return;
      // On click: advance to next message immediately, reset timer
      if (dareTimer) clearTimeout(dareTimer);
      const lang = document.documentElement.lang || 'en';
      const dares = daresByLang[lang] || daresByLang['en'];
      dareMsg.textContent = dares[dareIndex % dares.length];
      dareMsg.classList.add('visible');
      dareIndex++;
      dareTimer = setTimeout(() => {
        dareMsg.classList.remove('visible');
        dareTimer = null;
      }, DARE_DURATION);
    });
  }
}

customElements.define('ar-privacy', ArPrivacy);
