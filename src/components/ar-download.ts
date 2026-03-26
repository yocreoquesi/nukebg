import { generateOutputFilename } from '../utils/image-io';
import { t } from '../i18n';

export class ArDownload extends HTMLElement {
  private blobUrl: string | null = null;
  private resultBlob: Blob | null = null;
  private filename = 'image-clean.png';
  private timeMs = 0;
  private imgWidth = 0;
  private imgHeight = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    document.addEventListener('nukebg:locale-changed', () => {
      this.updateTexts();
    });
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const dlBtn = root.querySelector('#download-btn');
    if (dlBtn) dlBtn.textContent = t('download.btn');
    const copyBtn = root.querySelector('#copy-btn');
    if (copyBtn && !copyBtn.classList.contains('copied')) copyBtn.textContent = t('download.copy');
    const anotherBtn = root.querySelector('#another-btn');
    if (anotherBtn) anotherBtn.textContent = t('download.another');
  }

  disconnectedCallback(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
  }

  async setResult(imageData: ImageData, inputFilename: string, totalTimeMs: number, blob?: Blob): Promise<void> {
    this.imgWidth = imageData.width;
    this.imgHeight = imageData.height;
    this.timeMs = totalTimeMs;
    this.filename = generateOutputFilename(inputFilename);

    if (!blob) {
      const { exportPng } = await import('../utils/image-io');
      blob = await exportPng(imageData);
    }
    this.resultBlob = blob;

    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(blob);

    this.update();
  }

  getBlob(): Blob | null {
    return this.resultBlob;
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
          background: #00ff41;
          color: #000;
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
          gap: 8px;
          transition: background 0.3s ease, box-shadow 0.3s ease;
          box-shadow: 0 0 8px rgba(0, 255, 65, 0.2);
        }
        .btn-primary:hover {
          background: #33ff66;
          box-shadow: 0 0 15px rgba(0, 255, 65, 0.4);
        }
        .btn-primary:active { opacity: 0.9; }
        .btn-secondary {
          background: transparent;
          color: #00ff41;
          border: 1px solid #1a3a1a;
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
          background: rgba(0, 255, 65, 0.05);
          box-shadow: 0 0 8px rgba(0, 255, 65, 0.15);
        }
        .btn-copy {
          background: transparent;
          color: #00cc33;
          border: 1px solid #1a3a1a;
          padding: 10px 16px;
          border-radius: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .btn-copy:hover {
          border-color: #00ff41;
          color: #00ff41;
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
            font-size: 10px;
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

        .btn-copy.copied { border-color: #00ff41; color: #00ff41; }
        .metadata {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: #006622;
        }
        .separator { color: #1a3a1a; margin: 0 4px; }
      </style>
      <div class="download-bar" id="bar">
        <a class="btn-primary" id="download-btn">${t('download.btn')}</a>
        <button class="btn-copy" id="copy-btn" title="Copy to clipboard">${t('download.copy')}</button>
        <button class="btn-secondary" id="another-btn">${t('download.another')}</button>
        <span class="metadata" id="meta"></span>
      </div>
    `;

    this.shadowRoot!.querySelector('#another-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ar:process-another', { bubbles: true, composed: true }));
    });

    this.shadowRoot!.querySelector('#copy-btn')!.addEventListener('click', async () => {
      if (!this.resultBlob) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': this.resultBlob }),
        ]);
        const btn = this.shadowRoot!.querySelector('#copy-btn')!;
        btn.classList.add('copied');
        btn.textContent = t('download.copied');
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = t('download.copy');
        }, 2000);
      } catch {
        // Clipboard API not supported or permission denied — show feedback
        const btn = this.shadowRoot!.querySelector('#copy-btn')!;
        btn.textContent = t('download.copyFailed') || 'Copy not supported';
        setTimeout(() => {
          btn.textContent = t('download.copy');
        }, 2000);
      }
    });
  }

  private update(): void {
    const bar = this.shadowRoot!.querySelector('#bar')!;
    const btn = this.shadowRoot!.querySelector('#download-btn') as HTMLAnchorElement;
    const meta = this.shadowRoot!.querySelector('#meta')!;

    bar.classList.add('visible');

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
  }
}

customElements.define('ar-download', ArDownload);
