import { loadImage, isSupportedFormat } from '../utils/image-io';
import { t } from '../i18n';
import { getBatchLimit } from '../types/batch';
import { on } from '../lib/event-bus';

export class ArDropzone extends HTMLElement {
  private fileInput!: HTMLInputElement;
  private dropArea!: HTMLDivElement;
  private abortController: AbortController | null = null;

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

        /* Loading slot — model warmup progress lives inside the
           dropzone so the page doesn't reflow when fetch resolves.
           Sits in the same row as the camera CTA. */
        .dz-loading {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 10px;
          padding: 10px 12px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
          font-family: 'JetBrains Mono', monospace;
        }
        .dz-loading[hidden] { display: none; }
        .dz-loading-head {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .dz-loading-prompt { color: var(--color-text-tertiary, #00b34a); }
        .dz-loading-action {
          color: var(--color-accent-primary, #00ff41);
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .dz-loading-track {
          position: relative;
          height: 3px;
          background: var(--color-surface-border, #1a3a1a);
          overflow: hidden;
        }
        .dz-loading-bar {
          width: 0;
          height: 100%;
          background: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 6px var(--color-accent-glow, rgba(0, 255, 65, 0.35));
          transition: width 0.25s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .dz-loading-bar { transition: none; }
        }
        .dz-loading-label {
          font-size: 11px;
          color: var(--color-text-tertiary, #00b34a);
        }
        /* When the loading slot is visible, the camera CTA hides so
           the row swaps cleanly. */
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
        <!-- #146: dedicated 'tomar foto' camera CTA removed.
             Tapping the dropzone box already opens the OS file picker,
             which on mobile exposes the camera as one of the source
             options. The extra button was duplicating that affordance
             and making the mobile UX inconsistent with desktop. -->
        <!-- Loading slot — sits where the old camera CTA was so the
             dropzone doesn't reflow when the model finishes warming up.
             ar-app drives visibility + progress via setLoadingState(). -->
        <div class="dz-loading" id="dz-loading" role="status" aria-live="polite" hidden>
          <div class="dz-loading-head">
            <span class="dz-loading-prompt">$</span>
            <span class="dz-loading-action">fetch --model RMBG-1.4</span>
          </div>
          <div class="dz-loading-track" aria-hidden="true">
            <div class="dz-loading-bar" id="dz-loading-bar"></div>
          </div>
          <div class="dz-loading-label" id="dz-loading-label"># streaming weights…</div>
        </div>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" multiple />
    `;

    this.dropArea = this.shadowRoot!.querySelector('.dropzone')!;
    this.fileInput = this.shadowRoot!.querySelector('input[type="file"]')!;
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
  }

  private setupEvents(): void {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    on(document, 'nukebg:locale-changed', () => this.updateTexts(), { signal });

    // Click to open file picker. The OS picker exposes the camera as
    // one of the source options on mobile, so a dedicated camera CTA
    // is unnecessary (#146).
    this.dropArea.addEventListener('click', () => {
      this.fileInput.click();
    });

    // Keyboard support
    this.dropArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
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
    document.addEventListener(
      'paste',
      (e: ClipboardEvent) => {
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
      },
      { signal },
    );
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
    this.abortController = null;
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

  /**
   * Drive the in-dropzone loading slot used by ar-app while warming up
   * the ML model. Sits in the same vertical space as the camera CTA so
   * the page never reflows between "loading" and "ready".
   *
   * - `{ visible: true, pct, label }` → reveal the slot, update the bar
   * - `{ visible: true }` → reveal the slot (no progress yet)
   * - `{ visible: false, ready: true }` → fill bar, swap label to ready,
   *   then hide after a short delay so the user sees completion
   * - `{ visible: false }` → hide immediately (error/abort fallback)
   */
  setLoadingState(state: {
    visible: boolean;
    pct?: number;
    label?: string;
    ready?: boolean;
  }): void {
    const root = this.shadowRoot;
    if (!root) return;
    const slot = root.getElementById('dz-loading') as HTMLElement | null;
    const bar = root.getElementById('dz-loading-bar') as HTMLElement | null;
    const label = root.getElementById('dz-loading-label') as HTMLElement | null;
    if (!slot || !bar || !label) return;

    if (state.visible) {
      slot.hidden = false;
      this.dropArea?.classList.add('is-loading');
      if (typeof state.pct === 'number') {
        bar.style.width = `${Math.max(0, Math.min(100, state.pct))}%`;
      }
      if (state.label) label.textContent = state.label;
      return;
    }

    if (state.ready) {
      bar.style.width = '100%';
      label.textContent = t('firstRun.ready');
      window.setTimeout(() => {
        slot.hidden = true;
        this.dropArea?.classList.remove('is-loading');
      }, 600);
    } else {
      slot.hidden = true;
      this.dropArea?.classList.remove('is-loading');
    }
  }

  private async handleFile(file: File): Promise<void> {
    if (!isSupportedFormat(file.type)) {
      this.showError(t('dropzone.errorFormat') || 'Unsupported format. Use PNG, JPG, or WebP.');
      return;
    }

    try {
      const result = await loadImage(file);
      this.dispatchEvent(
        new CustomEvent('ar:image-loaded', {
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
        }),
      );
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

    this.dispatchEvent(
      new CustomEvent('ar:images-loaded', {
        bubbles: true,
        composed: true,
        detail: { images: loaded },
      }),
    );
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
