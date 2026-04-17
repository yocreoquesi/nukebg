import { exportPng, exportWebp, generateOutputFilename } from '../utils/image-io';
import { t, getLocale } from '../i18n';
import type { ExportFormat } from '../types/image';

export class ArDownload extends HTMLElement {
  private blobUrl: string | null = null;
  private resultBlob: Blob | null = null;
  private pngBlob: Blob | null = null;
  private currentImageData: ImageData | null = null;
  private inputFilename = '';
  private selectedFormat: ExportFormat = 'png';
  private filename = 'image-clean.png';
  private timeMs = 0;
  private imgWidth = 0;
  private imgHeight = 0;
  private boundLocaleHandler: (() => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const dlBtn = root.querySelector('#download-btn');
    if (dlBtn) dlBtn.textContent = this.selectedFormat === 'webp' ? t('download.btnWebp') : t('download.btn');
    const copyBtn = root.querySelector('#copy-btn');
    if (copyBtn && !copyBtn.classList.contains('copied')) copyBtn.innerHTML = `${t('download.copy')}<br><small>PNG</small>`;
    const anotherBtn = root.querySelector('#another-btn');
    if (anotherBtn) anotherBtn.textContent = t('download.another');
    this.updateFormatToggleLabels();
  }

  private updateFormatToggleLabels(): void {
    const root = this.shadowRoot!;
    const pngLabel = root.querySelector('#format-png-label');
    if (pngLabel) pngLabel.textContent = t('download.formatPng');
    const webpLabel = root.querySelector('#format-webp-label');
    if (webpLabel) webpLabel.textContent = t('download.formatWebp');
  }

  disconnectedCallback(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    if (this.boundLocaleHandler) document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  async setResult(imageData: ImageData, inputFilename: string, totalTimeMs: number, blob?: Blob): Promise<void> {
    this.currentImageData = imageData;
    this.inputFilename = inputFilename;
    this.imgWidth = imageData.width;
    this.imgHeight = imageData.height;
    this.timeMs = totalTimeMs;
    this.selectedFormat = 'png';
    this.filename = generateOutputFilename(inputFilename, 'png', getLocale());

    if (!blob) {
      blob = await exportPng(imageData);
    }
    this.resultBlob = blob;
    this.pngBlob = blob;

    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(blob);

    this.update();
    this.updateFormatToggleState();
  }

  getBlob(): Blob | null {
    return this.resultBlob;
  }

  private async switchFormat(format: ExportFormat): Promise<void> {
    if (format === this.selectedFormat || !this.currentImageData) return;
    this.selectedFormat = format;
    this.filename = generateOutputFilename(this.inputFilename, format, getLocale());

    let newBlob: Blob;
    if (format === 'webp') {
      newBlob = await exportWebp(this.currentImageData);
    } else {
      // Reuse cached PNG blob if available
      if (this.pngBlob) {
        newBlob = this.pngBlob;
      } else {
        newBlob = await exportPng(this.currentImageData);
        this.pngBlob = newBlob;
      }
    }

    // Revoke old URL only after new blob is ready
    this.resultBlob = newBlob;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(this.resultBlob);
    this.update();
    this.updateFormatToggleState();
  }

  private updateFormatToggleState(): void {
    const root = this.shadowRoot!;
    const pngBtn = root.querySelector('#format-png') as HTMLButtonElement | null;
    const webpBtn = root.querySelector('#format-webp') as HTMLButtonElement | null;
    if (pngBtn) {
      pngBtn.classList.toggle('active', this.selectedFormat === 'png');
      pngBtn.setAttribute('aria-pressed', String(this.selectedFormat === 'png'));
    }
    if (webpBtn) {
      webpBtn.classList.toggle('active', this.selectedFormat === 'webp');
      webpBtn.setAttribute('aria-pressed', String(this.selectedFormat === 'webp'));
    }
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .download-bar {
          display: none;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          padding: 16px;
          max-width: 900px;
          margin: 0 auto;
          justify-content: center;
        }
        .download-bar.visible { display: flex; }
        .btn-primary {
          background: var(--color-accent-primary, #00ff41);
          color: var(--color-text-inverse, #000);
          border: none;
          padding: 12px 24px;
          border-radius: 0;
          font-weight: 600;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 240px;
          transition: background 0.3s ease, box-shadow 0.3s ease;
          box-shadow: 0 0 8px var(--color-accent-glow, rgba(0, 255, 65, 0.2));
        }
        .btn-primary:hover {
          background: var(--color-accent-hover, #33ff66);
          box-shadow: 0 0 15px var(--color-accent-glow, rgba(0, 255, 65, 0.4));
        }
        .btn-primary:active { opacity: 0.9; }
        .btn-secondary {
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          padding: 10px 20px;
          border-radius: 0;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 500;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: background 0.3s ease, box-shadow 0.3s ease;
        }
        .btn-secondary:hover {
          background: var(--color-accent-muted, rgba(0, 255, 65, 0.05));
          box-shadow: 0 0 8px var(--color-accent-glow, rgba(0, 255, 65, 0.15));
        }
        .btn-copy {
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          padding: 10px 16px;
          border-radius: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .btn-copy small {
          font-size: 9px;
          opacity: 0.6;
          letter-spacing: 0.1em;
        }
        .btn-copy:hover {
          border-color: var(--color-accent-primary, #00ff41);
          color: var(--color-accent-primary, #00ff41);
        }
        @media (prefers-reduced-motion: reduce) {
          .btn-primary { animation: none !important; }
        }

        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .download-bar {
            flex-direction: column;
            gap: 8px;
            padding: 12px;
          }
          .btn-primary {
            width: 100%;
            justify-content: center;
            min-height: 44px;
            padding: 12px 16px;
            font-size: 12px;
          }
          .btn-secondary {
            width: 100%;
            text-align: center;
            min-height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .btn-copy {
            width: 100%;
            text-align: center;
            min-height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .metadata {
            text-align: center;
            font-size: 12px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .download-bar {
            gap: 10px;
            padding: 14px;
          }
          .btn-primary {
            min-height: 44px;
          }
          .btn-secondary {
            min-height: 44px;
          }
          .btn-copy {
            min-height: 44px;
          }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .btn-primary,
          .btn-secondary,
          .btn-copy {
            min-height: 44px;
            min-width: 44px;
          }
        }

        .btn-secondary:disabled {
          opacity: 0.4;
          pointer-events: none;
        }
        .btn-copy:disabled {
          opacity: 0.4;
          pointer-events: none;
        }
        .btn-copy.copied { border-color: var(--color-accent-primary, #00ff41); color: var(--color-accent-primary, #00ff41); }
        .metadata {
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--color-text-tertiary, #008830);
        }
        .separator { color: var(--color-surface-border, #1a3a1a); margin: 0 4px; }
        .format-toggle {
          display: inline-flex;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          overflow: hidden;
        }
        .format-toggle button {
          background: transparent;
          color: var(--color-text-tertiary, #008830);
          border: none;
          border-radius: 0;
          padding: 6px 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease;
        }
        .format-toggle button:not(:last-child) {
          border-right: 1px solid var(--color-surface-border, #1a3a1a);
        }
        .format-toggle button:hover {
          background: var(--color-accent-muted, rgba(0, 255, 65, 0.05));
          color: var(--color-text-secondary, #00dd44);
        }
        .format-toggle button.active {
          background: var(--color-accent-primary, #00ff41);
          color: var(--color-text-inverse, #000000);
          font-weight: 700;
        }
        @media (max-width: 480px) {
          .format-toggle {
            width: 100%;
            justify-content: center;
          }
          .format-toggle button {
            flex: 1;
            min-height: 44px;
          }
        }
        @media (pointer: coarse) {
          .format-toggle button {
            min-height: 44px;
            min-width: 44px;
          }
        }
      </style>
      <div class="download-bar" id="bar">
        <div class="format-toggle" role="group" aria-label="Export format">
          <button id="format-png" class="active" aria-pressed="true"><span id="format-png-label">${t('download.formatPng')}</span></button>
          <button id="format-webp" aria-pressed="false"><span id="format-webp-label">${t('download.formatWebp')}</span></button>
        </div>
        <a class="btn-primary" id="download-btn">${t('download.btn')}</a>
        <button class="btn-copy" id="copy-btn" title="Copy to clipboard" aria-live="polite">${t('download.copy')}<br><small>PNG</small></button>
        <button class="btn-secondary" id="another-btn">${t('download.another')}</button>
        <span class="metadata" id="meta"></span>
      </div>
    `;

    this.shadowRoot!.querySelector('#format-png')!.addEventListener('click', () => {
      this.switchFormat('png');
    });
    this.shadowRoot!.querySelector('#format-webp')!.addEventListener('click', () => {
      this.switchFormat('webp');
    });

    this.shadowRoot!.querySelector('#another-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ar:process-another', { bubbles: true, composed: true }));
    });

    this.shadowRoot!.querySelector('#copy-btn')!.addEventListener('click', async () => {
      if (!this.currentImageData) return;
      // Always copy as PNG for browser compatibility
      let pngBlob = this.pngBlob;
      if (!pngBlob) {
        pngBlob = await exportPng(this.currentImageData);
        this.pngBlob = pngBlob;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        const btn = this.shadowRoot!.querySelector('#copy-btn')!;
        btn.classList.add('copied');
        btn.innerHTML = `${t('download.copied')}<br><small>PNG</small>`;
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = `${t('download.copy')}<br><small>PNG</small>`;
        }, 2000);
      } catch {
        // Clipboard API not supported or permission denied - show feedback
        const btn = this.shadowRoot!.querySelector('#copy-btn')!;
        btn.innerHTML = `${t('download.copyFailed') || 'Copy not supported'}`;
        setTimeout(() => {
          btn.innerHTML = `${t('download.copy')}<br><small>PNG</small>`;
        }, 2000);
      }
    });
  }

  private update(): void {
    const bar = this.shadowRoot!.querySelector('#bar')!;
    const btn = this.shadowRoot!.querySelector('#download-btn') as HTMLAnchorElement;
    const meta = this.shadowRoot!.querySelector('#meta')!;

    bar.classList.add('visible');

    btn.textContent = this.selectedFormat === 'webp' ? t('download.btnWebp') : t('download.btn');

    if (this.blobUrl) {
      btn.setAttribute('href', this.blobUrl);
      btn.setAttribute('download', this.filename);
    }

    const sizeKb = this.resultBlob ? Math.round(this.resultBlob.size / 1024) : 0;
    const timeStr = (this.timeMs / 1000).toFixed(1);
    meta.innerHTML = `${this.imgWidth}x${this.imgHeight}` +
      `<span class="separator">|</span>${sizeKb} KB` +
      `<span class="separator">|</span>${timeStr}s`;
  }

  reset(): void {
    const bar = this.shadowRoot!.querySelector('#bar');
    if (bar) bar.classList.remove('visible');
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
    this.resultBlob = null;
    this.pngBlob = null;
    this.currentImageData = null;
    this.inputFilename = '';
    this.selectedFormat = 'png';
    this.updateFormatToggleState();
  }
}

customElements.define('ar-download', ArDownload);
