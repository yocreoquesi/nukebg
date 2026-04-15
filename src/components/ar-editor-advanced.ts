/**
 * Advanced editor — staging-only. Gated by isLabVisible().
 *
 * Scope of this component (growing across sub-commits):
 *   [step 1]   Skeleton: padded canvas (+25% each side), shows current result.
 *   [step 1.5] CTA placement + Antes/Después toggle (renders original or current).
 *   [step 2]   Brush + eraser. Brush restores pixels from the original RGBA.
 *              Eraser cuts alpha to 0. Both work via pointer drags; the canvas
 *              is +25% padded so strokes can cross the image edge freely.
 *              Edits outside the image extent are naturally discarded (the
 *              original has no data there for the brush to copy, and the pad
 *              is already transparent for the eraser).
 *   [step 3]   Freehand lasso with editable anchor handles.
 *   [step 4]   Lasso actions: Crop / Refine / Erase over the selection.
 *   [step 5]   Per-action undo stack + live sync with ar-viewer slider.
 *
 * Canvas model:
 *   Display canvas is (w + padX*2, h + padY*2) and is treated as read-only:
 *   we always redraw it from the `working` canvas (image-sized, where all
 *   edits live) plus an optional cursor preview. `original` is kept around
 *   image-sized so the brush can source authentic RGBA from it.
 *
 * Contract:
 *   setImage(current, original) — load both images. `current` is the last
 *   result (cropout). `original` is the untouched source.
 *   Emits:
 *     ar:advanced-done   { imageData }
 *     ar:advanced-cancel
 */

import { isLabVisible } from '../../exploration/lab-visibility';
import { t } from '../i18n';

const PAD_RATIO = 0.25;
const DEFAULT_BRUSH = 24;
const MIN_BRUSH = 4;
const MAX_BRUSH = 120;

type ViewMode = 'before' | 'after';
type Tool = 'brush' | 'eraser';

export class ArEditorAdvanced extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private current: ImageData | null = null;
  private original: ImageData | null = null;

  // Backing buffers at image resolution (no padding).
  private working: HTMLCanvasElement | null = null;
  private originalBacking: HTMLCanvasElement | null = null;

  private viewMode: ViewMode = 'after';
  private tool: Tool = 'eraser';
  private brushRadius = DEFAULT_BRUSH;

  private padX = 0;
  private padY = 0;

  private drawing = false;
  private lastImgX = 0;
  private lastImgY = 0;
  private cursorCanvasX: number | null = null;
  private cursorCanvasY: number | null = null;

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
    this.rebuildBackingBuffers();
    this.syncToggleUI();
    this.syncToolUI();
    this.paintCanvas();
  }

  private rebuildBackingBuffers(): void {
    if (!this.current || !this.original) return;

    this.working = document.createElement('canvas');
    this.working.width = this.current.width;
    this.working.height = this.current.height;
    this.working.getContext('2d')!.putImageData(this.current, 0, 0);

    this.originalBacking = document.createElement('canvas');
    this.originalBacking.width = this.original.width;
    this.originalBacking.height = this.original.height;
    this.originalBacking.getContext('2d')!.putImageData(this.original, 0, 0);
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
        .toolbar {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 8px;
          padding: 6px 8px;
          border: 1px solid rgba(255, 215, 0, 0.25);
          border-radius: 3px;
        }
        .tool-group {
          display: inline-flex;
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          overflow: hidden;
        }
        .tool-btn {
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
        .tool-btn + .tool-btn { border-left: 1px solid var(--color-accent, #ffd700); }
        .tool-btn.active {
          background: var(--color-accent, #ffd700);
          color: #000;
        }
        .size-row {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .size-row label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-secondary, #999);
        }
        .size-row input[type="range"] {
          accent-color: var(--color-accent, #ffd700);
          width: 120px;
        }
        .size-row .size-val {
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: var(--color-text, #ddd);
          min-width: 28px;
          text-align: right;
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
          cursor: crosshair;
        }
        canvas.disabled { cursor: not-allowed; }
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
        <div class="title">${t('advanced.title')}</div>
        <div class="view-toggle" role="group" aria-label="Before/after toggle">
          <button type="button" class="toggle-btn" id="view-before">${t('advanced.toggleBefore')}</button>
          <button type="button" class="toggle-btn active" id="view-after">${t('advanced.toggleAfter')}</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="tool-group" role="group" aria-label="Tools">
          <button type="button" class="tool-btn" id="tool-brush">${t('advanced.toolBrush')}</button>
          <button type="button" class="tool-btn active" id="tool-eraser">${t('advanced.toolEraser')}</button>
        </div>
        <div class="size-row">
          <label for="brush-size">${t('advanced.size')}</label>
          <input type="range" id="brush-size" min="${MIN_BRUSH}" max="${MAX_BRUSH}" step="1" value="${DEFAULT_BRUSH}">
          <span class="size-val" id="brush-size-val">${DEFAULT_BRUSH}</span>
        </div>
      </div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint">${t('advanced.hint')}</span>
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
    shadow.getElementById('tool-brush')!.addEventListener('click', () => this.setTool('brush'));
    shadow.getElementById('tool-eraser')!.addEventListener('click', () => this.setTool('eraser'));

    const sizeInput = shadow.getElementById('brush-size') as HTMLInputElement;
    const sizeVal = shadow.getElementById('brush-size-val')!;
    sizeInput.addEventListener('input', () => {
      this.brushRadius = parseInt(sizeInput.value, 10);
      sizeVal.textContent = String(this.brushRadius);
      this.redrawDisplay();
    });

    this.attachPointerHandlers();
  }

  private attachPointerHandlers(): void {
    const c = this.canvas;
    if (!c) return;

    c.addEventListener('pointerdown', (e) => {
      if (this.viewMode === 'before' || !this.working) return;
      c.setPointerCapture(e.pointerId);
      this.drawing = true;
      const [ix, iy] = this.eventToImageCoords(e);
      this.lastImgX = ix;
      this.lastImgY = iy;
      this.applyStrokeSegment(ix, iy, ix, iy);
      this.updateCursor(e);
      this.redrawDisplay();
    });

    c.addEventListener('pointermove', (e) => {
      this.updateCursor(e);
      if (!this.drawing || this.viewMode === 'before') {
        this.redrawDisplay();
        return;
      }
      const [ix, iy] = this.eventToImageCoords(e);
      this.applyStrokeSegment(this.lastImgX, this.lastImgY, ix, iy);
      this.lastImgX = ix;
      this.lastImgY = iy;
      this.redrawDisplay();
    });

    const endStroke = (e: PointerEvent) => {
      if (this.drawing) {
        this.drawing = false;
        try { c.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };
    c.addEventListener('pointerup', endStroke);
    c.addEventListener('pointercancel', endStroke);
    c.addEventListener('pointerleave', () => {
      this.cursorCanvasX = null;
      this.cursorCanvasY = null;
      this.redrawDisplay();
    });
  }

  private updateCursor(e: PointerEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    this.cursorCanvasX = (e.clientX - rect.left) * sx;
    this.cursorCanvasY = (e.clientY - rect.top) * sy;
  }

  private eventToImageCoords(e: PointerEvent): [number, number] {
    const rect = this.canvas!.getBoundingClientRect();
    const sx = this.canvas!.width / rect.width;
    const sy = this.canvas!.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    return [cx - this.padX, cy - this.padY];
  }

  private applyStrokeSegment(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.working) return;
    const wctx = this.working.getContext('2d')!;
    const r = this.brushRadius;

    if (this.tool === 'eraser') {
      wctx.save();
      wctx.globalCompositeOperation = 'destination-out';
      wctx.lineCap = 'round';
      wctx.lineJoin = 'round';
      wctx.lineWidth = r * 2;
      wctx.beginPath();
      wctx.moveTo(fromX, fromY);
      wctx.lineTo(toX, toY);
      wctx.stroke();
      wctx.restore();
      return;
    }

    // Brush: stamp a series of arcs along the segment and restore RGBA from
    // the original inside each clipped arc. Pixels outside the original's
    // extent stay unchanged because drawImage has no data there.
    if (!this.originalBacking) return;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, r * 0.4);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const tfrac = steps === 0 ? 0 : i / steps;
      const cx = fromX + dx * tfrac;
      const cy = fromY + dy * tfrac;
      wctx.save();
      wctx.beginPath();
      wctx.arc(cx, cy, r, 0, Math.PI * 2);
      wctx.clip();
      wctx.drawImage(this.originalBacking, 0, 0);
      wctx.restore();
    }
  }

  private setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.syncToggleUI();
    if (this.canvas) this.canvas.classList.toggle('disabled', mode === 'before');
    this.redrawDisplay();
  }

  private setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.syncToolUI();
    this.redrawDisplay();
  }

  private syncToggleUI(): void {
    const before = this.shadowRoot?.getElementById('view-before');
    const after = this.shadowRoot?.getElementById('view-after');
    if (!before || !after) return;
    before.classList.toggle('active', this.viewMode === 'before');
    after.classList.toggle('active', this.viewMode === 'after');
  }

  private syncToolUI(): void {
    const brush = this.shadowRoot?.getElementById('tool-brush');
    const eraser = this.shadowRoot?.getElementById('tool-eraser');
    if (!brush || !eraser) return;
    brush.classList.toggle('active', this.tool === 'brush');
    eraser.classList.toggle('active', this.tool === 'eraser');
  }

  private paintCanvas(): void {
    if (!this.canvas || !this.ctx || !this.current) return;
    const w = this.current.width;
    const h = this.current.height;
    this.padX = Math.round(w * PAD_RATIO);
    this.padY = Math.round(h * PAD_RATIO);
    this.canvas.width = w + this.padX * 2;
    this.canvas.height = h + this.padY * 2;
    this.redrawDisplay();
  }

  private redrawDisplay(): void {
    if (!this.canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const source = this.viewMode === 'before' ? this.originalBacking : this.working;
    if (source) this.ctx.drawImage(source, this.padX, this.padY);

    if (this.cursorCanvasX != null && this.cursorCanvasY != null && this.viewMode === 'after') {
      this.ctx.save();
      this.ctx.strokeStyle = this.tool === 'eraser' ? 'rgba(255, 80, 80, 0.95)' : 'rgba(255, 215, 0, 0.95)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 4]);
      this.ctx.beginPath();
      this.ctx.arc(this.cursorCanvasX, this.cursorCanvasY, this.brushRadius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private cancel(): void {
    this.removeAttribute('active');
    this.dispatchEvent(new CustomEvent('ar:advanced-cancel', { bubbles: true, composed: true }));
  }

  private commit(): void {
    if (!this.working || !this.current) return;
    const out = this.working
      .getContext('2d')!
      .getImageData(0, 0, this.current.width, this.current.height);
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
