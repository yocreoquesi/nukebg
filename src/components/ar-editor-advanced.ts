/**
 * Advanced editor — staging-only. Gated by isLabVisible().
 *
 * Scope of this component (growing across sub-commits):
 *   [step 1]   Skeleton: padded canvas (+25% each side), shows current result.
 *   [step 1.5] CTA placement + Antes/Después toggle (renders original or current).
 *   [step 2]   Brush + eraser (drawing allowed beyond image bounds).
 *   [step 3]   Freehand lasso with editable anchor handles.
 *   [step 4]   Lasso actions: Crop / Refine / Erase over the selection.
 *   [step 5]   Per-action undo stack + live sync with ar-viewer slider.
 *
 * Canvas model:
 *   The internal canvas is larger than the working image by PAD_RATIO on
 *   each side. Pixels outside the image bounds are transparent — the user
 *   can paint/erase into that margin so edge adjustments are easier. On
 *   commit, we crop back to the image's bounding rect before emitting.
 *
 * Contract:
 *   setImage(current, original) — load both images. `current` is the last
 *   result (cropout). `original` is the untouched source, used for the
 *   Antes/Después toggle and, in step 4, as RGB reference for refine.
 *   Emits:
 *     ar:advanced-done   { imageData }
 *     ar:advanced-cancel
 */

import { isLabVisible } from '../../exploration/lab-visibility';
import { t } from '../i18n';

const PAD_RATIO = 0.25;

type ViewMode = 'before' | 'after';

export class ArEditorAdvanced extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private current: ImageData | null = null;
  private original: ImageData | null = null;
  private viewMode: ViewMode = 'after';
  private padX = 0;
  private padY = 0;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
  }

  setImage(current: ImageData, original: ImageData): void {
    this.current = current;
    this.original = original;
    this.viewMode = 'after';
    this.syncToggleUI();
    this.paintCanvas();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: none;
          margin-top: 12px;
          padding: 12px;
          border: 1px dashed var(--color-accent, #ffd700);
          border-radius: 4px;
          background: rgba(255, 215, 0, 0.04);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text, #ddd);
        }
        :host([active]) { display: block; }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .title {
          color: var(--color-accent, #ffd700);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .view-toggle {
          display: inline-flex;
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          overflow: hidden;
        }
        .toggle-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent, #ffd700);
          border: none;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .toggle-btn + .toggle-btn { border-left: 1px solid var(--color-accent, #ffd700); }
        .toggle-btn.active {
          background: var(--color-accent, #ffd700);
          color: #000;
        }
        .canvas-wrap {
          background:
            linear-gradient(45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(-45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            linear-gradient(-45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            #0d0d0d;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 200px;
          position: relative;
        }
        canvas {
          max-width: 100%;
          max-height: 70vh;
          display: block;
          touch-action: none;
        }
        .controls {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .hint {
          flex: 1;
          font-size: 10px;
          color: var(--color-text-tertiary, #888);
          align-self: center;
        }
        button.action {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 5px 12px;
          cursor: pointer;
        }
        button.action:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        button.action:disabled { opacity: 0.4; cursor: not-allowed; }
        button.action.secondary { color: var(--color-text-secondary, #999); border-color: var(--color-border, #444); }
      </style>
      <div class="header">
        <div class="title" id="title">${t('advanced.title')}</div>
        <div class="view-toggle" role="group" aria-label="Before/after toggle">
          <button type="button" class="toggle-btn" id="view-before">${t('advanced.toggleBefore')}</button>
          <button type="button" class="toggle-btn active" id="view-after">${t('advanced.toggleAfter')}</button>
        </div>
      </div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint">Canvas padded +25%. Brush/lasso tools coming next.</span>
        <button type="button" class="action secondary" id="cancel">${t('advanced.cancel')}</button>
        <button type="button" class="action" id="done">${t('advanced.apply')}</button>
      </div>
    `;
    this.canvas = shadow.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');

    shadow.getElementById('cancel')!.addEventListener('click', () => this.cancel());
    shadow.getElementById('done')!.addEventListener('click', () => this.commit());
    shadow.getElementById('view-before')!.addEventListener('click', () => this.setViewMode('before'));
    shadow.getElementById('view-after')!.addEventListener('click', () => this.setViewMode('after'));
  }

  private setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.syncToggleUI();
    this.paintCanvas();
  }

  private syncToggleUI(): void {
    const before = this.shadowRoot?.getElementById('view-before');
    const after = this.shadowRoot?.getElementById('view-after');
    if (!before || !after) return;
    before.classList.toggle('active', this.viewMode === 'before');
    after.classList.toggle('active', this.viewMode === 'after');
  }

  private paintCanvas(): void {
    if (!this.canvas || !this.ctx || !this.current) return;
    const source = this.viewMode === 'before' ? (this.original ?? this.current) : this.current;
    const w = source.width;
    const h = source.height;
    this.padX = Math.round(w * PAD_RATIO);
    this.padY = Math.round(h * PAD_RATIO);
    this.canvas.width = w + this.padX * 2;
    this.canvas.height = h + this.padY * 2;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.putImageData(source, this.padX, this.padY);
  }

  private cancel(): void {
    this.removeAttribute('active');
    this.dispatchEvent(new CustomEvent('ar:advanced-cancel', { bubbles: true, composed: true }));
  }

  private commit(): void {
    if (!this.canvas || !this.ctx || !this.current) return;
    // Step 1.5: still a no-op roundtrip. Always emit `current` untouched so
    // toggling to "before" for inspection doesn't accidentally overwrite the
    // result with the original image. Real editing arrives in step 2+.
    const out = new ImageData(
      new Uint8ClampedArray(this.current.data),
      this.current.width,
      this.current.height,
    );
    this.removeAttribute('active');
    this.dispatchEvent(
      new CustomEvent('ar:advanced-done', {
        detail: { imageData: out },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('ar-editor-advanced', ArEditorAdvanced);
