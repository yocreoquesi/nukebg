/**
 * Before/after comparison viewer with interactive slider.
 * Differentiator: slider comparison (like remove.bg) + toggle transparency view
 * + replace background with custom color.
 */
import { t } from '../i18n';

export class ArViewer extends HTMLElement {
  private container!: HTMLDivElement;
  private originalCanvas!: HTMLCanvasElement;
  private resultCanvas!: HTMLCanvasElement;
  private sliderPos = 50;
  private isDragging = false;
  private bgColor = 'transparent'; // transparent, white, black, or hex

  // Bound handlers for cleanup
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: (() => void) | null = null;
  private boundTouchMove: ((e: TouchEvent) => void) | null = null;
  private boundTouchEnd: (() => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    document.addEventListener('nukebg:locale-changed', () => {
      const root = this.shadowRoot!;
      const origLabel = root.querySelector('#lbl-original');
      if (origLabel) origLabel.textContent = t('viewer.original');
      const resultLabel = root.querySelector('#lbl-result');
      if (resultLabel) resultLabel.textContent = t('viewer.result');
      const bgLabel = root.querySelector('#viewer-bg-label');
      if (bgLabel) bgLabel.textContent = t('viewer.bg');
    });
  }

  disconnectedCallback(): void {
    if (this.boundMouseMove) document.removeEventListener('mousemove', this.boundMouseMove);
    if (this.boundMouseUp) document.removeEventListener('mouseup', this.boundMouseUp);
    if (this.boundTouchMove) document.removeEventListener('touchmove', this.boundTouchMove);
    if (this.boundTouchEnd) document.removeEventListener('touchend', this.boundTouchEnd);
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .viewer-container {
          position: relative;
          max-width: 900px;
          margin: 0 auto;
          border-radius: 0;
          overflow: hidden;
          border: 1px solid #1a3a1a;
          cursor: col-resize;
          user-select: none;
          -webkit-user-select: none;
        }
        .canvas-layer {
          display: block;
          width: 100%;
          height: auto;
          max-height: 600px;
          object-fit: contain;
        }
        .result-layer {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          overflow: hidden;
        }
        .result-layer canvas {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        /* Checkerboard for transparency */
        .checker-bg {
          background-image:
            linear-gradient(45deg, #1c1c1f 25%, transparent 25%),
            linear-gradient(-45deg, #1c1c1f 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #1c1c1f 75%),
            linear-gradient(-45deg, transparent 75%, #1c1c1f 75%);
          background-size: 12px 12px;
          background-position: 0 0, 0 6px, 6px -6px, 6px 0;
          background-color: #2a2a2e;
        }
        .slider-line {
          position: absolute;
          top: 0; bottom: 0;
          width: 2px;
          background: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 6px rgba(0, 255, 65, 0.4);
          pointer-events: none;
          z-index: 10;
        }
        .slider-handle {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 28px; height: 28px;
          border-radius: 0;
          background: var(--color-accent-primary, #00ff41);
          border: 2px solid #000;
          cursor: col-resize;
          z-index: 11;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: #000;
          box-shadow: 0 0 10px rgba(0, 255, 65, 0.4);
        }
        .label {
          position: absolute;
          top: 8px;
          background: rgba(0, 0, 0, 0.85);
          color: var(--color-accent-primary, #00ff41);
          padding: 2px 10px;
          border-radius: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          pointer-events: none;
          z-index: 5;
        }
        .label-original { left: 8px; }
        .label-result { right: 8px; }
        .info-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--color-text-secondary, #00cc33);
          background: #000;
          border-top: 1px solid #1a3a1a;
        }
        .bg-options {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .bg-options span { font-size: 11px; color: var(--color-text-tertiary, #006622); }
        .bg-btn {
          width: 20px; height: 20px;
          border-radius: 0;
          border: 2px solid transparent;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .bg-btn:hover, .bg-btn.active { border-color: var(--color-accent-primary, #00ff41); }
        .bg-checker {
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%),
            linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%),
            linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 6px 6px;
          background-position: 0 0, 0 3px, 3px -3px, 3px 0;
          background-color: #fff;
        }
        .bg-white { background: #fff; }
        .bg-black { background: #000; }
        .bg-red { background: #ff4444; }

        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .viewer-container {
            max-width: 100%;
          }
          .canvas-layer {
            max-height: 400px;
          }
          .slider-handle {
            width: 44px;
            height: 44px;
            font-size: 16px;
          }
          .label {
            font-size: 9px;
            padding: 2px 6px;
          }
          .info-bar {
            flex-direction: column;
            gap: 6px;
            padding: 6px 8px;
            font-size: 10px;
          }
          .bg-btn {
            width: 28px;
            height: 28px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .viewer-container {
            max-width: 100%;
          }
          .slider-handle {
            width: 44px;
            height: 44px;
            font-size: 14px;
          }
          .bg-btn {
            width: 28px;
            height: 28px;
          }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .slider-handle {
            width: 44px;
            height: 44px;
          }
          .bg-btn {
            width: 32px;
            height: 32px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .slider-line, .slider-handle {
            transition: none !important;
          }
        }

      </style>
      <div class="viewer-container checker-bg" id="container">
        <canvas class="canvas-layer" id="original"></canvas>
        <div class="result-layer" id="result-layer">
          <canvas id="result"></canvas>
        </div>
        <div class="slider-line" id="slider-line"></div>
        <div class="slider-handle" id="slider-handle">&#8596;</div>
        <span class="label label-original" id="lbl-original">${t('viewer.original')}</span>
        <span class="label label-result" id="lbl-result">${t('viewer.result')}</span>
      </div>
      <div class="info-bar">
        <span id="info-text"></span>
        <div class="bg-options">
          <span id="viewer-bg-label">${t('viewer.bg')}</span>
          <div class="bg-btn bg-checker active" data-bg="transparent" title="Transparent"></div>
          <div class="bg-btn bg-white" data-bg="white" title="White"></div>
          <div class="bg-btn bg-black" data-bg="black" title="Black"></div>
          <div class="bg-btn" style="background:#00b140" data-bg="#00b140" title="Green screen"></div>
          <div class="bg-btn bg-red" data-bg="#ff4444" title="Red (check edges)"></div>
        </div>
      </div>
    `;

    this.container = this.shadowRoot!.querySelector('#container')!;
    this.originalCanvas = this.shadowRoot!.querySelector('#original')!;
    this.resultCanvas = this.shadowRoot!.querySelector('#result')!;

    this.setupSlider();
    this.setupBgButtons();
    this.updateSlider();
  }

  private setupSlider(): void {
    const onMove = (clientX: number) => {
      if (!this.isDragging) return;
      const rect = this.container.getBoundingClientRect();
      this.sliderPos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      this.updateSlider();
    };

    this.container.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      onMove(e.clientX);
    });
    this.boundMouseMove = (e: MouseEvent) => onMove(e.clientX);
    this.boundMouseUp = () => { this.isDragging = false; };
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);

    // Touch support
    this.container.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      onMove(e.touches[0].clientX);
    }, { passive: true });
    this.boundTouchMove = (e: TouchEvent) => { if (this.isDragging) onMove(e.touches[0].clientX); };
    this.boundTouchEnd = () => { this.isDragging = false; };
    document.addEventListener('touchmove', this.boundTouchMove, { passive: true });
    document.addEventListener('touchend', this.boundTouchEnd);
  }

  private setupBgButtons(): void {
    this.shadowRoot!.querySelectorAll('.bg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shadowRoot!.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.bgColor = (btn as HTMLElement).dataset.bg || 'transparent';
        this.applyBgColor();
      });
    });
  }

  private applyBgColor(): void {
    const container = this.shadowRoot!.querySelector('#container') as HTMLElement;
    const layer = this.shadowRoot!.querySelector('#result-layer') as HTMLElement;
    if (this.bgColor === 'transparent') {
      container.className = 'viewer-container checker-bg';
      container.style.backgroundColor = '';
      layer.className = 'result-layer';
      layer.style.backgroundColor = '';
    } else {
      container.className = 'viewer-container';
      container.style.backgroundColor = this.bgColor;
      layer.className = 'result-layer';
      layer.style.backgroundColor = '';
    }
  }

  private updateSlider(): void {
    const line = this.shadowRoot!.querySelector('#slider-line') as HTMLElement;
    const handle = this.shadowRoot!.querySelector('#slider-handle') as HTMLElement;
    const resultLayer = this.shadowRoot!.querySelector('#result-layer') as HTMLElement;

    line.style.left = `${this.sliderPos}%`;
    handle.style.left = `${this.sliderPos}%`;
    const clipValue = `inset(0 0 0 ${this.sliderPos}%)`;
    resultLayer.style.clipPath = clipValue;
    // -webkit- prefix for older Safari
    resultLayer.style.setProperty('-webkit-clip-path', clipValue);
  }

  setOriginal(imageData: ImageData, fileSize?: number): void {
    const ctx = this.originalCanvas.getContext('2d')!;
    this.originalCanvas.width = imageData.width;
    this.originalCanvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);

    // Show full original (slider all the way right = result clipped away)
    this.sliderPos = 100;
    this.updateSlider();

    const info = this.shadowRoot!.querySelector('#info-text')!;
    const sizeStr = fileSize ? ` | ${Math.round(fileSize / 1024)} KB` : '';
    info.textContent = `${imageData.width}x${imageData.height}${sizeStr}`;
  }

  clearResult(): void {
    const ctx = this.resultCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.resultCanvas.width, this.resultCanvas.height);
    }
    this.sliderPos = 100;
    this.updateSlider();
  }

  setResult(imageData: ImageData, blob?: Blob): void {
    const ctx = this.resultCanvas.getContext('2d')!;
    this.resultCanvas.width = imageData.width;
    this.resultCanvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);

    // Animate slider reveal
    this.sliderPos = 100;
    this.updateSlider();
    requestAnimationFrame(() => {
      const start = performance.now();
      const animate = (now: number) => {
        const progress = Math.min((now - start) / 800, 1);
        // Ease out
        const eased = 1 - Math.pow(1 - progress, 3);
        this.sliderPos = 100 - eased * 100;
        this.updateSlider();
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });

    const info = this.shadowRoot!.querySelector('#info-text')!;
    const sizeStr = blob ? ` | ${Math.round(blob.size / 1024)} KB` : '';
    info.textContent = `${imageData.width}x${imageData.height}${sizeStr}`;
  }
}

customElements.define('ar-viewer', ArViewer);
