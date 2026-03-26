import { loadImage, isSupportedFormat } from '../utils/image-io';
import { t } from '../i18n';

export class ArDropzone extends HTMLElement {
  private fileInput!: HTMLInputElement;
  private dropArea!: HTMLDivElement;

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
        .dropzone {
          border: 1px solid #1a3a1a;
          border-radius: 0;
          background: #000;
          padding: 2rem;
          min-height: 200px;
          max-width: 100%;
          margin: 0 auto;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          transition: border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease;
          text-align: center;
        }
        .dropzone::before {
          content: 'nukebg@local:~$ ';
          display: block;
          color: var(--color-text-tertiary, #006622);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          margin-bottom: 8px;
          text-align: left;
          width: 100%;
        }
        .dropzone:hover {
          border-color: var(--color-accent-primary, #00ff41);
          background: rgba(0, 255, 65, 0.02);
          box-shadow: 0 0 10px rgba(0, 255, 65, 0.1);
        }
        .dropzone.dragover {
          border-color: var(--color-accent-primary, #00ff41);
          border-style: solid;
          background: rgba(0, 255, 65, 0.04);
          box-shadow: 0 0 15px rgba(0, 255, 65, 0.15);
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
        .icon {
          font-size: 24px;
          color: var(--color-text-tertiary, #006622);
          line-height: 1;
          transition: color 0.3s ease, filter 0.3s ease;
        }
        .dropzone:hover .icon {
          color: var(--color-accent-primary, #00ff41);
          filter: drop-shadow(0 0 6px rgba(0, 255, 65, 0.5));
        }
        .main-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-sm, 0.875rem);
          font-weight: var(--font-medium, 500);
          color: var(--color-accent-primary, #00ff41);
        }
        .main-text::before {
          content: '> ';
          color: var(--color-text-tertiary, #006622);
        }
        .sub-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00cc33);
        }
        .hint {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: #004d1a;
        }
        .dragover-text {
          display: none;
        }
        .dropzone.dragover .idle-content { display: none; }
        .dropzone.dragover .dragover-text { display: block; }
        input[type="file"] { display: none; }
        :host(:focus-visible) .dropzone,
        .dropzone:focus-visible {
          outline: none;
          box-shadow: 0 0 10px rgba(0, 255, 65, 0.25),
                      0 0 0 2px #00ff41;
        }
        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .dropzone {
            padding: 1.25rem 1rem;
            min-height: 150px;
            gap: 0.5rem;
          }
          .dropzone::before {
            font-size: 10px;
            margin-bottom: 4px;
          }
          .icon {
            font-size: 20px;
          }
          .main-text {
            font-size: var(--text-xs, 0.75rem);
          }
          .sub-text {
            font-size: 11px;
          }
          .hint {
            font-size: 9px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .dropzone {
            padding: 1.5rem;
            min-height: 170px;
          }
          .main-text {
            font-size: var(--text-sm, 0.875rem);
          }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .dropzone {
            min-height: 150px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .dropzone { animation: none !important; }
          .dropzone.dragover { animation: none !important; }
        }
      </style>
      <div class="dropzone" role="button" tabindex="0"
           aria-label="${t('dropzone.ariaLabel')}">
        <div class="idle-content">
          <div class="icon">&#9729;</div>
          <div class="main-text" id="dz-title">${t('dropzone.title')}</div>
          <div class="sub-text" id="dz-subtitle">${t('dropzone.subtitle')}</div>
          <div class="hint" id="dz-formats">${t('dropzone.formats')}</div>
          <div class="hint" id="dz-clipboard">${t('dropzone.clipboard')}</div>
        </div>
        <div class="dragover-text">
          <div class="main-text" id="dz-dragover">${t('dropzone.dragover')}</div>
        </div>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" />
    `;

    this.dropArea = this.shadowRoot!.querySelector('.dropzone')!;
    this.fileInput = this.shadowRoot!.querySelector('input[type="file"]')!;
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const title = root.querySelector('#dz-title');
    if (title) title.textContent = t('dropzone.title');
    const subtitle = root.querySelector('#dz-subtitle');
    if (subtitle) subtitle.textContent = t('dropzone.subtitle');
    const formats = root.querySelector('#dz-formats');
    if (formats) formats.textContent = t('dropzone.formats');
    const clipboard = root.querySelector('#dz-clipboard');
    if (clipboard) clipboard.textContent = t('dropzone.clipboard');
    const dragover = root.querySelector('#dz-dragover');
    if (dragover) dragover.textContent = t('dropzone.dragover');
    const dropzone = root.querySelector('.dropzone');
    if (dropzone) dropzone.setAttribute('aria-label', t('dropzone.ariaLabel'));
  }

  private setupEvents(): void {
    // Escuchar cambio de idioma
    document.addEventListener('nukebg:locale-changed', () => {
      this.updateTexts();
    });

    // Click to open file picker
    this.dropArea.addEventListener('click', () => this.fileInput.click());

    // Keyboard support
    this.dropArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.fileInput.click();
      }
    });

    // File input change
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.[0]) {
        this.handleFile(this.fileInput.files[0]);
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
      const file = e.dataTransfer?.files[0];
      if (file) this.handleFile(file);
    });

    // Paste from clipboard
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) this.handleFile(file);
          break;
        }
      }
    });
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
