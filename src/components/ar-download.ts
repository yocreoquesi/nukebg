import { exportPng, exportWebp, generateOutputFilename } from '../utils/image-io';
import { t, getLocale } from '../i18n';
import type { ExportFormat } from '../types/image';

export class ArDownload extends HTMLElement {
  private pngBlobUrl: string | null = null;
  private webpBlobUrl: string | null = null;
  private pngBlob: Blob | null = null;
  private webpBlob: Blob | null = null;
  private currentImageData: ImageData | null = null;
  private selectedFormat: ExportFormat = 'png';
  private pngFilename = 'image.png';
  private webpFilename = 'image.webp';
  private imgWidth = 0;
  private imgHeight = 0;
  private hasAlpha = true;
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
    const copyBtn = root.querySelector('#copy-btn');
    if (copyBtn && !copyBtn.classList.contains('copied')) copyBtn.innerHTML = `${t('download.copy')}<br><small>PNG</small>`;
    const anotherBtn = root.querySelector('#another-btn');
    if (anotherBtn) anotherBtn.textContent = t('download.another');
    const shareBtn = root.querySelector('#share-btn');
    if (shareBtn) shareBtn.innerHTML = `${t('download.share')}<br><small>PNG</small>`;
    this.updateCtaLabels();
  }

  private updateCtaLabels(): void {
    const root = this.shadowRoot!;
    const pngCmd = root.querySelector('#dl-png-cmd');
    if (pngCmd) pngCmd.textContent = t('download.cta.png');
    const webpCmd = root.querySelector('#dl-webp-cmd');
    if (webpCmd) webpCmd.textContent = t('download.cta.webp');
  }

  disconnectedCallback(): void {
    if (this.pngBlobUrl) URL.revokeObjectURL(this.pngBlobUrl);
    if (this.webpBlobUrl) URL.revokeObjectURL(this.webpBlobUrl);
    if (this.boundLocaleHandler) document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  /**
   * Detect whether the result has a transparent channel.
   * Samples at most 256 pixels — enough to tell "has alpha" vs "fully opaque"
   * without scanning 32 MP. Conservative: if any sampled pixel is < 255, we
   * mark alpha present.
   */
  private detectAlpha(imageData: ImageData): boolean {
    const data = imageData.data;
    const total = imageData.width * imageData.height;
    if (total === 0) return false;
    const stride = Math.max(1, Math.floor(total / 256));
    for (let i = 0; i < total; i += stride) {
      if (data[i * 4 + 3] < 255) return true;
    }
    return false;
  }

  async setResult(imageData: ImageData, inputFilename: string, _totalTimeMs: number, blob?: Blob): Promise<void> {
    this.currentImageData = imageData;
    this.imgWidth = imageData.width;
    this.imgHeight = imageData.height;
    this.selectedFormat = 'png';
    this.hasAlpha = this.detectAlpha(imageData);
    this.pngFilename = generateOutputFilename(inputFilename, 'png', getLocale());
    this.webpFilename = generateOutputFilename(inputFilename, 'webp', getLocale());

    // Prepare PNG blob eagerly (it's the primary CTA).
    if (!blob) blob = await exportPng(imageData);
    this.pngBlob = blob;
    if (this.pngBlobUrl) URL.revokeObjectURL(this.pngBlobUrl);
    this.pngBlobUrl = URL.createObjectURL(blob);

    // Prepare WebP blob lazily — it's the secondary CTA; encode in the
    // background so its size metadata renders as soon as ready.
    this.updateCtaAnchors('png-only');
    this.syncShareButton();
    void this.prepareWebp(imageData);

    this.show();
  }

  private async prepareWebp(imageData: ImageData): Promise<void> {
    if (this.currentImageData !== imageData) return; // a newer run replaced us
    try {
      const blob = await exportWebp(imageData);
      if (this.currentImageData !== imageData) return;
      this.webpBlob = blob;
      if (this.webpBlobUrl) URL.revokeObjectURL(this.webpBlobUrl);
      this.webpBlobUrl = URL.createObjectURL(blob);
      this.updateCtaAnchors('both');
    } catch (err) {
      // WebP encode is best-effort; hide the secondary CTA if it fails.
      console.warn('[ar-download] WebP encode failed:', err);
      this.updateCtaAnchors('png-only');
    }
  }

  /**
   * External callers (editor done, batch retry, etc.) that re-export a PNG
   * can still point us at a fresh blob. Kept for backwards compatibility
   * with the old switchFormat() path.
   */
  getBlob(): Blob | null {
    return this.selectedFormat === 'webp' ? this.webpBlob : this.pngBlob;
  }

  private show(): void {
    const bar = this.shadowRoot!.querySelector('#bar');
    if (bar) bar.classList.add('visible');
  }

  /**
   * Show the Web Share button if (a) the PNG blob is ready and
   * (b) the browser reports support for sharing files. Safari
   * (desktop + iOS), Chromium on Android, and Edge qualify; desktop
   * Chromium + Firefox return false and the button stays hidden.
   */
  private syncShareButton(): void {
    const btn = this.shadowRoot?.querySelector('#share-btn') as HTMLButtonElement | null;
    if (!btn || !this.pngBlob) return;
    try {
      const probe = new File([this.pngBlob], this.pngFilename, { type: 'image/png' });
      btn.hidden = !(navigator.canShare && navigator.canShare({ files: [probe] }));
    } catch {
      btn.hidden = true;
    }
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .download-bar {
          display: none;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          max-width: 900px;
          margin: 0 auto;
          justify-content: center;
        }
        .download-bar.visible { display: flex; }
        /* Two-line terminal-style download CTAs per design #72 */
        .dl-ctas {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: stretch;
        }
        .dl-cta {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          padding: 10px 18px;
          font-family: 'JetBrains Mono', monospace;
          text-decoration: none;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          background: transparent;
          cursor: pointer;
          min-width: 220px;
          min-height: 56px;
          transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .dl-cta[hidden] { display: none; }
        .dl-cta-cmd {
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.08em;
          color: var(--color-text-secondary, #00dd44);
        }
        .dl-cta-meta {
          font-size: 11px;
          color: var(--color-text-tertiary, #00b34a);
        }
        .dl-cta-primary {
          border-color: var(--color-accent-primary, #00ff41);
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.05);
          min-width: 280px;
        }
        .dl-cta-primary .dl-cta-cmd {
          color: var(--color-accent-primary, #00ff41);
          font-weight: 600;
          text-shadow: 0 0 6px var(--color-accent-glow, rgba(0, 255, 65, 0.35));
        }
        .dl-cta:hover,
        .dl-cta:focus-visible {
          border-color: var(--color-accent-primary, #00ff41);
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.09);
          outline: none;
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.2);
        }
        .dl-cta:active { opacity: 0.9; }
        .dl-side {
          display: flex;
          gap: 8px;
          align-items: center;
        }
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
            align-items: stretch;
          }
          .dl-ctas {
            flex-direction: column;
            width: 100%;
          }
          .dl-cta {
            min-width: 0;
            width: 100%;
          }
          .dl-side {
            justify-content: center;
            flex-wrap: wrap;
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
          .btn-secondary,
          .btn-copy,
          .dl-cta {
            min-height: 44px;
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
      </style>
      <div class="download-bar" id="bar">
        <div class="dl-ctas" role="group" aria-label="${t('download.groupLabel') || 'Download'}">
          <a class="dl-cta dl-cta-primary" id="dl-png" hidden>
            <span class="dl-cta-cmd" id="dl-png-cmd">${t('download.cta.png')}</span>
            <span class="dl-cta-meta" id="dl-png-meta"></span>
          </a>
          <a class="dl-cta dl-cta-secondary" id="dl-webp" hidden>
            <span class="dl-cta-cmd" id="dl-webp-cmd">${t('download.cta.webp')}</span>
            <span class="dl-cta-meta" id="dl-webp-meta"></span>
          </a>
        </div>
        <div class="dl-side">
          <button class="btn-copy" id="copy-btn" title="Copy to clipboard" aria-live="polite">${t('download.copy')}<br><small>PNG</small></button>
          <button class="btn-secondary" id="share-btn" hidden aria-live="polite">${t('download.share')}<br><small>PNG</small></button>
          <button class="btn-secondary" id="another-btn">${t('download.another')}</button>
        </div>
      </div>
    `;

    this.shadowRoot!.querySelector('#another-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ar:process-another', { bubbles: true, composed: true }));
    });

    // Web Share API (#74). Only exposed on engines that can actually
    // share files — `navigator.canShare({ files })` returns false on
    // desktop Chromium + older Safari, so we keep the button hidden
    // and let the Copy + Download paths handle those cases.
    const shareBtn = this.shadowRoot!.querySelector('#share-btn') as HTMLButtonElement | null;
    shareBtn?.addEventListener('click', async () => {
      if (!this.pngBlob) return;
      const file = new File([this.pngBlob], this.pngFilename, { type: 'image/png' });
      try {
        // canShare re-check at click time (user may have disabled
        // sharing between page load and click).
        if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
          shareBtn.hidden = true;
          return;
        }
        await navigator.share({
          files: [file],
          title: t('download.share.title'),
          text: t('download.share.text'),
          url: 'https://nukebg.app',
        });
      } catch (err) {
        // AbortError = user dismissed the share sheet; not an error.
        if ((err as DOMException)?.name === 'AbortError') return;
        console.warn('[ar-download] share failed:', err);
      }
    });
    // Track which format the user clicked so external callers (editor /
    // clipboard) know the latest intent via this.selectedFormat.
    this.shadowRoot!.querySelector('#dl-png')!.addEventListener('click', () => {
      this.selectedFormat = 'png';
    });
    this.shadowRoot!.querySelector('#dl-webp')!.addEventListener('click', () => {
      this.selectedFormat = 'webp';
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

  /**
   * Refresh the two download anchors with current blob URLs, filenames
   * and metadata lines. Called when PNG is ready (then again when WebP
   * catches up). The `scope` arg controls whether the WebP anchor is
   * shown — hidden until its encode completes.
   */
  private updateCtaAnchors(scope: 'png-only' | 'both'): void {
    const root = this.shadowRoot!;
    const png = root.querySelector('#dl-png') as HTMLAnchorElement | null;
    const webp = root.querySelector('#dl-webp') as HTMLAnchorElement | null;
    const pngMeta = root.querySelector('#dl-png-meta') as HTMLElement | null;
    const webpMeta = root.querySelector('#dl-webp-meta') as HTMLElement | null;

    if (png && this.pngBlobUrl && pngMeta) {
      png.hidden = false;
      png.setAttribute('href', this.pngBlobUrl);
      png.setAttribute('download', this.pngFilename);
      pngMeta.textContent = this.formatMeta(this.pngBlob?.size ?? 0);
    }
    if (webp && webpMeta) {
      if (scope === 'both' && this.webpBlobUrl) {
        webp.hidden = false;
        webp.setAttribute('href', this.webpBlobUrl);
        webp.setAttribute('download', this.webpFilename);
        webpMeta.textContent = this.formatMeta(this.webpBlob?.size ?? 0);
      } else {
        webp.hidden = true;
      }
    }
  }

  private formatMeta(bytes: number): string {
    const sizeStr = this.formatBytes(bytes);
    const parts = [`${this.imgWidth}×${this.imgHeight}`, sizeStr];
    if (this.hasAlpha) parts.push(t('download.meta.alpha'));
    return `# ${parts.join(' · ')}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  reset(): void {
    const bar = this.shadowRoot!.querySelector('#bar');
    if (bar) bar.classList.remove('visible');
    if (this.pngBlobUrl) { URL.revokeObjectURL(this.pngBlobUrl); this.pngBlobUrl = null; }
    if (this.webpBlobUrl) { URL.revokeObjectURL(this.webpBlobUrl); this.webpBlobUrl = null; }
    this.pngBlob = null;
    this.webpBlob = null;
    this.currentImageData = null;
    this.selectedFormat = 'png';
    const root = this.shadowRoot!;
    const png = root.querySelector('#dl-png') as HTMLAnchorElement | null;
    const webp = root.querySelector('#dl-webp') as HTMLAnchorElement | null;
    if (png) { png.hidden = true; png.removeAttribute('href'); }
    if (webp) { webp.hidden = true; webp.removeAttribute('href'); }
    const shareBtn = root.querySelector('#share-btn') as HTMLButtonElement | null;
    if (shareBtn) shareBtn.hidden = true;
  }
}

customElements.define('ar-download', ArDownload);
