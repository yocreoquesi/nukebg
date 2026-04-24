import { loadImage, isSupportedFormat } from '../utils/image-io';
import { t } from '../i18n';
import { getBatchLimit } from '../types/batch';

export class ArDropzone extends HTMLElement {
  private fileInput!: HTMLInputElement;
  private cameraInput!: HTMLInputElement;
  private dropArea!: HTMLDivElement;
  private boundLocaleHandler: (() => void) | null = null;
  private boundPasteHandler: ((e: ClipboardEvent) => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.setupEvents();
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        /* ASCII-framed dropzone per design #69.
           Outer: accent-primary border + soft glow + inner stroke.
           Inside: terminal prompt row, large centered drop target, bottom
           meta row. The four corner glyphs sit absolute-positioned as
           decoration — they don't affect layout. */
        .dropzone {
          position: relative;
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          background: var(--color-bg-primary, #000);
          padding: 28px 28px 20px;
          min-height: 320px;
          max-width: 100%;
          margin: 0 auto;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0;
          transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
          box-shadow:
            0 0 14px rgba(var(--color-accent-rgb, 0, 255, 65), 0.08),
            inset 0 0 0 4px #000,
            inset 0 0 0 5px rgba(var(--color-accent-rgb, 0, 255, 65), 0.15);
        }
        .dz-corner {
          position: absolute;
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          font-size: 16px;
          line-height: 1;
          text-shadow: 0 0 6px rgba(var(--color-accent-rgb, 0, 255, 65), 0.5);
          pointer-events: none;
        }
        .dz-corner.tl { top: 6px; left: 8px; }
        .dz-corner.tr { top: 6px; right: 8px; }
        .dz-corner.bl { bottom: 6px; left: 8px; }
        .dz-corner.br { bottom: 6px; right: 8px; }
        .dz-prompt {
          color: var(--color-text-tertiary, #00b34a);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .dz-prompt .cmd {
          color: var(--color-text-secondary, #00dd44);
        }
        .dz-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          text-align: center;
        }
        .dz-glyph {
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.2em;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          padding: 4px 10px;
          transition: border-color 0.2s ease, color 0.2s ease;
        }
        .dropzone:hover .dz-glyph,
        .dropzone.dragover .dz-glyph {
          border-color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 6px rgba(var(--color-accent-rgb, 0, 255, 65), 0.5);
        }
        .dz-title {
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.35);
        }
        .dz-hint {
          color: var(--color-text-secondary, #00dd44);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .dz-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 10px;
          margin-top: 14px;
          border-top: 1px dashed var(--color-surface-border, #1a3a1a);
          color: var(--color-text-tertiary, #00b34a);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .dz-foot .hint-multi::before {
          content: '[*] ';
          color: var(--color-accent-primary, #00ff41);
        }
        /* Camera CTA — mobile-only (#73). Triggers a second file input
           with capture="environment" so iOS / Android opens the camera
           directly instead of the photo library. */
        .dz-camera-cta {
          display: none;
          margin-top: 10px;
          padding: 10px 14px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          letter-spacing: 0.05em;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          cursor: pointer;
          min-height: 44px;
          transition: background 0.15s ease, box-shadow 0.15s ease;
        }
        .dz-camera-cta:hover,
        .dz-camera-cta:focus-visible {
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.08);
          box-shadow: 0 0 8px rgba(var(--color-accent-rgb, 0, 255, 65), 0.2);
          outline: none;
        }
        @media (pointer: coarse), (max-width: 480px) {
          .dz-camera-cta { display: inline-flex; align-items: center; justify-content: center; }
        }
        .dz-camera-input { display: none; }
        .dropzone:hover {
          box-shadow:
            0 0 18px rgba(var(--color-accent-rgb, 0, 255, 65), 0.14),
            inset 0 0 0 4px #000,
            inset 0 0 0 5px rgba(var(--color-accent-rgb, 0, 255, 65), 0.25);
        }
        .dropzone.dragover {
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.04);
          box-shadow:
            0 0 22px rgba(var(--color-accent-rgb, 0, 255, 65), 0.22),
            inset 0 0 0 4px #000,
            inset 0 0 0 5px rgba(var(--color-accent-rgb, 0, 255, 65), 0.35);
        }
        .dropzone.error {
          animation: shake 0.3s;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          50% { transform: translateX(6px); }
          75% { transform: translateX(-6px); }
        }
        .dragover-text {
          display: none;
        }
        .dropzone.dragover .idle-content { display: none; }
        .dropzone.dragover .dragover-text {
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: center;
        }
        .dropzone.dragover .dragover-text .dz-title { font-size: 24px; }
        input[type="file"] { display: none; }
        .dropzone.dropzone-disabled {
          opacity: 0.4;
          pointer-events: none;
        }
        :host(:focus-visible) .dropzone,
        .dropzone:focus-visible {
          outline: none;
          box-shadow:
            0 0 10px var(--color-accent-glow, rgba(0, 255, 65, 0.25)),
            0 0 0 2px var(--color-accent-primary, #00ff41),
            inset 0 0 0 4px #000,
            inset 0 0 0 5px rgba(var(--color-accent-rgb, 0, 255, 65), 0.25);
        }
        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .dropzone {
            padding: 18px 14px 14px;
            min-height: 44vh;
          }
          .dz-corner { font-size: 14px; top: 4px; bottom: 4px; left: 6px; right: 6px; }
          .dz-corner.tl { top: 4px; left: 6px; bottom: auto; right: auto; }
          .dz-corner.tr { top: 4px; right: 6px; bottom: auto; left: auto; }
          .dz-corner.bl { bottom: 4px; left: 6px; top: auto; right: auto; }
          .dz-corner.br { bottom: 4px; right: 6px; top: auto; left: auto; }
          .dz-title { font-size: 16px; }
          .dz-hint { font-size: 11px; }
          .dz-foot { font-size: 10px; flex-direction: column; gap: 4px; align-items: stretch; }
          .dz-foot span:last-child { text-align: right; }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .dropzone {
            padding: 22px 20px 16px;
            min-height: 280px;
          }
          .dz-title { font-size: 18px; }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .dz-glyph { padding: 8px 14px; font-size: 13px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .dropzone { animation: none !important; transition: none !important; }
          .dropzone.dragover { animation: none !important; }
        }
      </style>
      <div class="dropzone" role="button" tabindex="0"
           aria-label="${t('dropzone.ariaLabel')}">
        <span class="dz-corner tl" aria-hidden="true">&#9484;</span>
        <span class="dz-corner tr" aria-hidden="true">&#9488;</span>
        <span class="dz-corner bl" aria-hidden="true">&#9492;</span>
        <span class="dz-corner br" aria-hidden="true">&#9496;</span>
        <div class="dz-prompt">nukebg@local:~$ <span class="cmd">drop --image</span></div>
        <div class="idle-content dz-center">
          <div class="dz-glyph" aria-hidden="true">[ &#8595; ]</div>
          <div class="dz-title" id="dz-title">${t('dropzone.title')}</div>
          <div class="dz-hint" id="dz-hint">${t('dropzone.hint')}</div>
        </div>
        <div class="dragover-text">
          <div class="dz-title" id="dz-dragover">${t('dropzone.dragover')}</div>
        </div>
        <div class="dz-foot">
          <span id="dz-formats">${t('dropzone.formats')}</span>
          <span class="hint-multi" id="dz-multi">${t('dropzone.multi')}</span>
        </div>
        <button type="button" class="dz-camera-cta" id="dz-camera-cta">
          &#8227; ${t('dropzone.takePhoto')}
        </button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" multiple />
      <input type="file" accept="image/*" capture="environment" class="dz-camera-input" />
    `;

    this.dropArea = this.shadowRoot!.querySelector('.dropzone')!;
    this.fileInput = this.shadowRoot!.querySelector('input[type="file"]:not(.dz-camera-input)')!;
    this.cameraInput = this.shadowRoot!.querySelector('input.dz-camera-input')!;
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const title = root.querySelector('#dz-title');
    if (title) title.textContent = t('dropzone.title');
    const hint = root.querySelector('#dz-hint');
    if (hint) hint.textContent = t('dropzone.hint');
    const formats = root.querySelector('#dz-formats');
    if (formats) formats.textContent = t('dropzone.formats');
    const multi = root.querySelector('#dz-multi');
    if (multi) multi.textContent = t('dropzone.multi');
    const dragover = root.querySelector('#dz-dragover');
    if (dragover) dragover.textContent = t('dropzone.dragover');
    const dropzone = root.querySelector('.dropzone');
    if (dropzone) dropzone.setAttribute('aria-label', t('dropzone.ariaLabel'));
    const camera = root.querySelector('#dz-camera-cta');
    if (camera) camera.innerHTML = `&#8227; ${t('dropzone.takePhoto')}`;
  }

  private setupEvents(): void {
    // Listen for locale changes
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);

    // Click to open file picker — but ignore clicks that bubbled from
    // the inline camera CTA button (it manages its own file input).
    this.dropArea.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#dz-camera-cta')) return;
      this.fileInput.click();
    });

    // Keyboard support
    this.dropArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('#dz-camera-cta')) return;
        e.preventDefault();
        this.fileInput.click();
      }
    });

    // File input change
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        this.handleFiles(this.fileInput.files);
      }
    });

    // Camera CTA (#73). Opens a second file input with
    // capture="environment" so iOS / Android treat it as a camera
    // intent instead of the photo library picker.
    const cameraBtn = this.shadowRoot!.querySelector('#dz-camera-cta') as HTMLButtonElement | null;
    cameraBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cameraInput.click();
    });
    this.cameraInput.addEventListener('change', () => {
      if (this.cameraInput.files && this.cameraInput.files.length > 0) {
        this.handleFiles(this.cameraInput.files);
      }
    });

    // Drag events
    this.dropArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropArea.classList.add('dragover');
    });
    this.dropArea.addEventListener('dragleave', () => {
      this.dropArea.classList.remove('dragover');
    });
    this.dropArea.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropArea.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) this.handleFiles(files);
    });

    // Paste from clipboard
    this.boundPasteHandler = (e: ClipboardEvent) => {
      if (this.dropArea.classList.contains('dropzone-disabled')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) this.handleFile(file);
          break;
        }
      }
    };
    document.addEventListener('paste', this.boundPasteHandler);
  }

  disconnectedCallback(): void {
    if (this.boundLocaleHandler) document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
    if (this.boundPasteHandler) document.removeEventListener('paste', this.boundPasteHandler);
  }

  /** Enable or disable the dropzone (used to block interaction until model is ready) */
  setEnabled(enabled: boolean): void {
    if (!this.dropArea) return;
    if (enabled) {
      this.dropArea.classList.remove('dropzone-disabled');
    } else {
      this.dropArea.classList.add('dropzone-disabled');
    }
  }

  private async handleFile(file: File): Promise<void> {
    if (!isSupportedFormat(file.type)) {
      this.showError(t('dropzone.errorFormat') || 'Unsupported format. Use PNG, JPG, or WebP.');
      return;
    }

    try {
      const result = await loadImage(file);
      this.dispatchEvent(new CustomEvent('ar:image-loaded', {
        bubbles: true,
        composed: true,
        detail: {
          file,
          imageData: result.imageData,
          originalImageData: result.originalImageData,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          wasDownsampled: result.wasDownsampled,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load image.';
      this.showError(msg);
    }
  }

  /**
   * Handle a list of files from drop or file-picker. When exactly one valid
   * image is selected we emit the classic ar:image-loaded event so the
   * single-file workspace UX stays untouched. Two or more valid images
   * trigger ar:images-loaded (plural) which ar-app renders as a batch grid.
   */
  private async handleFiles(fileList: FileList): Promise<void> {
    const valid: File[] = [];
    for (const f of Array.from(fileList)) {
      if (isSupportedFormat(f.type)) valid.push(f);
    }

    if (valid.length === 0) {
      this.showError(t('dropzone.errorFormat') || 'Unsupported format. Use PNG, JPG, or WebP.');
      return;
    }

    const limit = getBatchLimit();
    const accepted = valid.slice(0, limit);
    const overLimit = valid.length > limit;

    if (accepted.length === 1) {
      await this.handleFile(accepted[0]);
      return;
    }

    const loaded: Array<{
      file: File;
      imageData: ImageData;
      originalImageData: ImageData;
      originalWidth: number;
      originalHeight: number;
      wasDownsampled: boolean;
    }> = [];

    for (const file of accepted) {
      try {
        const result = await loadImage(file);
        loaded.push({
          file,
          imageData: result.imageData,
          originalImageData: result.originalImageData,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          wasDownsampled: result.wasDownsampled,
        });
      } catch {
        // Silently skip images that fail to load; batch mode should not
        // block the whole selection on a single broken file.
      }
    }

    if (loaded.length === 0) {
      this.showError(t('dropzone.errorFormat') || 'Unsupported format. Use PNG, JPG, or WebP.');
      return;
    }

    if (overLimit) {
      this.showError(t('batch.limitExceeded', { limit: String(limit) }));
    }

    this.dispatchEvent(new CustomEvent('ar:images-loaded', {
      bubbles: true,
      composed: true,
      detail: { images: loaded },
    }));
  }

  private showError(message?: string): void {
    this.dropArea.classList.add('error');
    if (message) {
      const title = this.shadowRoot!.querySelector('#dz-title');
      const originalText = title?.textContent || '';
      if (title) title.textContent = message;
      setTimeout(() => {
        if (title) title.textContent = originalText;
      }, 3000);
    }
    setTimeout(() => this.dropArea.classList.remove('error'), 300);
  }
}

customElements.define('ar-dropzone', ArDropzone);
