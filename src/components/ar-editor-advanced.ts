/**
 * Advanced editor — staging-only. Gated by isLabVisible().
 *
 * Scope of this component (growing across sub-commits):
 *   [step 1] Skeleton: padded canvas (+25% each side), shows current result
 *   [step 2] Brush + eraser (drawing allowed beyond image bounds).
 *   [step 3] Freehand lasso with editable anchor handles.
 *   [step 4] Lasso actions: Crop / Refine / Erase over the selection.
 *   [step 5] Per-action undo stack + live sync with ar-viewer slider.
 *
 * Canvas model:
 *   The internal canvas is larger than the working image by PAD_RATIO on
 *   each side. Pixels outside the image bounds are transparent — the user
 *   can paint/erase into that margin so edge adjustments are easier. On
 *   commit, we crop back to the image's bounding rect before emitting.
 *
 * Contract:
 *   setImage(current, original) — load both images. `current` is the last
 *   result (cropout). `original` is the untouched source for RGB reference.
 *   Emits:
 *     ar:advanced-done   { imageData }
 *     ar:advanced-cancel
 */

import { isLabVisible } from '../../exploration/lab-visibility';

const PAD_RATIO = 0.25;

export class ArEditorAdvanced extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private current: ImageData | null = null;
  private padX = 0;
  private padY = 0;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
  }

  setImage(current: ImageData, _original: ImageData): void {
    // `_original` will be used by the refine action (step 4) to pull fresh
    // RGB when re-segmenting an ROI. Unused for now — argument kept so the
    // caller contract is stable across steps.
    this.current = current;
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
        .title {
          color: var(--color-accent, #ffd700);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
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
        button {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 5px 12px;
          cursor: pointer;
        }
        button:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        button.secondary { color: var(--color-text-secondary, #999); border-color: var(--color-border, #444); }
      </style>
      <div class="title">[LAB] Advanced editor — scaffold</div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint">Canvas padded +25% on each side. Tools coming in step 2.</span>
        <button class="secondary" id="cancel">Cancel</button>
        <button id="done">Apply</button>
      </div>
    `;
    this.canvas = shadow.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');

    shadow.getElementById('cancel')!.addEventListener('click', () => this.cancel());
    shadow.getElementById('done')!.addEventListener('click', () => this.commit());
  }

  private paintCanvas(): void {
    if (!this.canvas || !this.ctx || !this.current) return;
    const w = this.current.width;
    const h = this.current.height;
    this.padX = Math.round(w * PAD_RATIO);
    this.padY = Math.round(h * PAD_RATIO);
    this.canvas.width = w + this.padX * 2;
    this.canvas.height = h + this.padY * 2;

    // Transparent padding is already the default — only paint the image.
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.putImageData(this.current, this.padX, this.padY);
  }

  private cancel(): void {
    this.removeAttribute('active');
    this.dispatchEvent(new CustomEvent('ar:advanced-cancel', { bubbles: true, composed: true }));
  }

  private commit(): void {
    if (!this.canvas || !this.ctx || !this.current) return;
    // Step 1: no edits yet — just emit the original current image unchanged
    // so the event plumbing can be validated end-to-end.
    const w = this.current.width;
    const h = this.current.height;
    const out = this.ctx.getImageData(this.padX, this.padY, w, h);
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
