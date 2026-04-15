/**
 * Advanced editor — staging-only. Gated by isLabVisible().
 *
 * Scope of this component (growing across sub-commits):
 *   [step 1]   Skeleton: padded canvas (+25% each side), shows current result.
 *   [step 1.5] CTA placement + Antes/Después toggle (renders original or current).
 *   [step 2]   Brush + eraser. Brush restores pixels from the original RGBA.
 *              Eraser cuts alpha to 0. Both work via pointer drags; the canvas
 *              is +25% padded so strokes can cross the image edge freely.
 *   [step 3]   Freehand lasso with editable anchor handles. Drag-paint a loop
 *              → Douglas-Peucker simplification → draggable points, double-
 *              click removes one. Esc clears the selection. No action on the
 *              lasso yet — step 4 wires Crop/Refine/Erase over it.
 *   [step 4]   Lasso actions: Crop / Refine / Erase over the selection.
 *   [step 5]   Per-action undo stack + live sync with ar-viewer slider.
 *
 * Canvas model:
 *   Display canvas is (w + padX*2, h + padY*2) and is treated as read-only:
 *   we always redraw it from the `working` canvas (image-sized, where all
 *   edits live) plus an optional cursor/lasso overlay. `original` is kept
 *   around image-sized so the brush can source authentic RGBA from it.
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
import { simplifyClosed, type Point } from './lasso-simplify';

const PAD_RATIO = 0.25;
const DEFAULT_BRUSH = 24;
const MIN_BRUSH = 4;
const MAX_BRUSH = 120;

// Lasso tuning — all values are in image-space pixels so they scale
// proportionally on the display canvas via the standard max-width fit.
const MIN_LASSO_POINT_DIST = 2;
// Fraction of min(w, h) used as Douglas-Peucker epsilon.
const LASSO_EPS_RATIO = 0.006;
// Minimum anchors we'll ever let the user delete down to — below this
// the polygon stops being meaningful.
const MIN_ANCHORS = 3;

type ViewMode = 'before' | 'after';
type Tool = 'brush' | 'eraser' | 'lasso';

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

  // Lasso state (all coordinates in image-space — may be outside [0..w/h]
  // because the canvas is padded and loops can cross the image edge).
  private lassoRaw: Point[] | null = null;
  private lassoAnchors: Point[] | null = null;
  private dragAnchorIndex: number | null = null;

  private abort: AbortController | null = null;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
  }

  disconnectedCallback(): void {
    this.abort?.abort();
    this.abort = null;
  }

  setImage(current: ImageData, original: ImageData): void {
    this.current = current;
    this.original = original;
    this.viewMode = 'after';
    this.clearLasso();
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
        .size-row.hidden { display: none; }
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
          <button type="button" class="tool-btn" id="tool-lasso">${t('advanced.toolLasso')}</button>
        </div>
        <div class="size-row" id="size-row">
          <label for="brush-size">${t('advanced.size')}</label>
          <input type="range" id="brush-size" min="${MIN_BRUSH}" max="${MAX_BRUSH}" step="1" value="${DEFAULT_BRUSH}">
          <span class="size-val" id="brush-size-val">${DEFAULT_BRUSH}</span>
        </div>
      </div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint" id="hint">${t('advanced.hint')}</span>
        <button type="button" class="action secondary" id="cancel">${t('advanced.cancel')}</button>
        <button type="button" class="action" id="done">${t('advanced.apply')}</button>
      </div>
    `;
    this.canvas = shadow.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');

    this.abort = new AbortController();
    const { signal } = this.abort;

    shadow.getElementById('cancel')!.addEventListener('click', () => this.cancel(), { signal });
    shadow.getElementById('done')!.addEventListener('click', () => this.commit(), { signal });
    shadow.getElementById('view-before')!.addEventListener('click', () => this.setViewMode('before'), { signal });
    shadow.getElementById('view-after')!.addEventListener('click', () => this.setViewMode('after'), { signal });
    shadow.getElementById('tool-brush')!.addEventListener('click', () => this.setTool('brush'), { signal });
    shadow.getElementById('tool-eraser')!.addEventListener('click', () => this.setTool('eraser'), { signal });
    shadow.getElementById('tool-lasso')!.addEventListener('click', () => this.setTool('lasso'), { signal });

    const sizeInput = shadow.getElementById('brush-size') as HTMLInputElement;
    const sizeVal = shadow.getElementById('brush-size-val')!;
    sizeInput.addEventListener('input', () => {
      this.brushRadius = parseInt(sizeInput.value, 10);
      sizeVal.textContent = String(this.brushRadius);
      this.redrawDisplay();
    }, { signal });

    this.attachPointerHandlers(signal);
    this.attachKeyboardHandlers(signal);
  }

  private attachPointerHandlers(signal: AbortSignal): void {
    const c = this.canvas;
    if (!c) return;

    c.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    c.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    c.addEventListener('pointerup', (e) => this.onPointerEnd(e), { signal });
    c.addEventListener('pointercancel', (e) => this.onPointerEnd(e), { signal });
    c.addEventListener('pointerleave', () => {
      this.cursorCanvasX = null;
      this.cursorCanvasY = null;
      this.redrawDisplay();
    }, { signal });
    c.addEventListener('dblclick', (e) => this.onDblClick(e), { signal });
  }

  private attachKeyboardHandlers(signal: AbortSignal): void {
    window.addEventListener('keydown', (e) => {
      if (!this.hasAttribute('active')) return;
      if (e.key === 'Escape') {
        if (this.lassoAnchors || this.lassoRaw) {
          e.preventDefault();
          this.clearLasso();
          this.redrawDisplay();
        }
        return;
      }
      // Brush size hotkeys only meaningful for brush/eraser
      if (this.tool !== 'lasso' && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const delta = e.key === ']' ? 4 : -4;
        this.setBrushRadius(this.brushRadius + delta);
      }
    }, { signal });
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.viewMode === 'before' || !this.canvas) return;
    const [ix, iy] = this.eventToImageCoords(e);
    this.updateCursor(e);

    if (this.tool === 'lasso') {
      // Hit-test existing anchors first — dragging one reshapes the polygon.
      if (this.lassoAnchors) {
        const idx = this.hitAnchor(ix, iy);
        if (idx !== null) {
          this.dragAnchorIndex = idx;
          try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
          return;
        }
        // Pointer down elsewhere with an active lasso: treat as "start a
        // brand new selection". Dropping the old one is friendlier than
        // requiring an explicit Esc to clear first.
        this.clearLasso();
      }
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      this.drawing = true;
      this.lassoRaw = [{ x: ix, y: iy }];
      this.redrawDisplay();
      return;
    }

    // brush / eraser
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    this.drawing = true;
    this.lastImgX = ix;
    this.lastImgY = iy;
    this.applyStrokeSegment(ix, iy, ix, iy);
    this.redrawDisplay();
  }

  private onPointerMove(e: PointerEvent): void {
    this.updateCursor(e);
    const [ix, iy] = this.eventToImageCoords(e);

    if (this.tool === 'lasso') {
      if (this.dragAnchorIndex !== null && this.lassoAnchors) {
        this.lassoAnchors[this.dragAnchorIndex] = { x: ix, y: iy };
        this.redrawDisplay();
        return;
      }
      if (this.drawing && this.lassoRaw) {
        const last = this.lassoRaw[this.lassoRaw.length - 1];
        if (Math.hypot(ix - last.x, iy - last.y) >= MIN_LASSO_POINT_DIST) {
          this.lassoRaw.push({ x: ix, y: iy });
          this.redrawDisplay();
          return;
        }
      }
      // Hover only — still repaint so the cursor preview tracks.
      this.redrawDisplay();
      return;
    }

    if (!this.drawing || this.viewMode === 'before') {
      this.redrawDisplay();
      return;
    }
    this.applyStrokeSegment(this.lastImgX, this.lastImgY, ix, iy);
    this.lastImgX = ix;
    this.lastImgY = iy;
    this.redrawDisplay();
  }

  private onPointerEnd(e: PointerEvent): void {
    if (!this.canvas) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (this.tool === 'lasso') {
      if (this.dragAnchorIndex !== null) {
        this.dragAnchorIndex = null;
        return;
      }
      if (this.drawing && this.lassoRaw) {
        if (this.lassoRaw.length >= MIN_ANCHORS) {
          const w = this.current?.width ?? 0;
          const h = this.current?.height ?? 0;
          const eps = Math.max(1.5, Math.min(w, h) * LASSO_EPS_RATIO);
          this.lassoAnchors = simplifyClosed(this.lassoRaw, eps);
          // Extremely short loops can collapse below 3 anchors — drop.
          if (this.lassoAnchors.length < MIN_ANCHORS) this.lassoAnchors = null;
        }
        this.lassoRaw = null;
      }
      this.drawing = false;
      this.redrawDisplay();
      return;
    }

    this.drawing = false;
  }

  private onDblClick(e: MouseEvent): void {
    if (this.tool !== 'lasso' || !this.lassoAnchors) return;
    const [ix, iy] = this.eventToImageCoordsFromMouse(e);
    const idx = this.hitAnchor(ix, iy);
    if (idx === null) return;
    if (this.lassoAnchors.length <= MIN_ANCHORS) return;
    this.lassoAnchors.splice(idx, 1);
    this.redrawDisplay();
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
    return this.eventToImageCoordsFromMouse(e);
  }

  private eventToImageCoordsFromMouse(e: MouseEvent): [number, number] {
    const rect = this.canvas!.getBoundingClientRect();
    const sx = this.canvas!.width / rect.width;
    const sy = this.canvas!.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    return [cx - this.padX, cy - this.padY];
  }

  private setBrushRadius(r: number): void {
    this.brushRadius = Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, Math.round(r)));
    const input = this.shadowRoot?.getElementById('brush-size') as HTMLInputElement | null;
    const val = this.shadowRoot?.getElementById('brush-size-val');
    if (input) input.value = String(this.brushRadius);
    if (val) val.textContent = String(this.brushRadius);
    this.redrawDisplay();
  }

  private anchorRadius(): number {
    if (!this.current) return 6;
    return Math.max(6, Math.round(Math.min(this.current.width, this.current.height) * 0.008));
  }

  private hitAnchor(ix: number, iy: number): number | null {
    if (!this.lassoAnchors) return null;
    const tol = this.anchorRadius() + 4;
    const tolSq = tol * tol;
    for (let i = 0; i < this.lassoAnchors.length; i++) {
      const a = this.lassoAnchors[i];
      const dx = a.x - ix;
      const dy = a.y - iy;
      if (dx * dx + dy * dy <= tolSq) return i;
    }
    return null;
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

    if (this.tool !== 'brush' || !this.originalBacking) return;
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
    const lasso = this.shadowRoot?.getElementById('tool-lasso');
    const sizeRow = this.shadowRoot?.getElementById('size-row');
    const hint = this.shadowRoot?.getElementById('hint');
    if (brush) brush.classList.toggle('active', this.tool === 'brush');
    if (eraser) eraser.classList.toggle('active', this.tool === 'eraser');
    if (lasso) lasso.classList.toggle('active', this.tool === 'lasso');
    if (sizeRow) sizeRow.classList.toggle('hidden', this.tool === 'lasso');
    if (hint) hint.textContent = this.tool === 'lasso' ? t('advanced.hintLasso') : t('advanced.hint');
  }

  private clearLasso(): void {
    this.lassoRaw = null;
    this.lassoAnchors = null;
    this.dragAnchorIndex = null;
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

    this.drawLassoOverlay();
    this.drawCursorPreview();
  }

  private drawLassoOverlay(): void {
    if (!this.ctx) return;

    // Raw in-progress path — open polyline.
    if (this.lassoRaw && this.lassoRaw.length > 1) {
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      const p0 = this.lassoRaw[0];
      this.ctx.moveTo(p0.x + this.padX, p0.y + this.padY);
      for (let i = 1; i < this.lassoRaw.length; i++) {
        this.ctx.lineTo(this.lassoRaw[i].x + this.padX, this.lassoRaw[i].y + this.padY);
      }
      this.ctx.stroke();
      this.ctx.restore();
      return;
    }

    // Simplified anchors — filled polygon + marching-ants outline + handles.
    if (this.lassoAnchors && this.lassoAnchors.length >= MIN_ANCHORS) {
      const pts = this.lassoAnchors;
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
      this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(pts[0].x + this.padX, pts[0].y + this.padY);
      for (let i = 1; i < pts.length; i++) {
        this.ctx.lineTo(pts[i].x + this.padX, pts[i].y + this.padY);
      }
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      this.ctx.setLineDash([]);
      this.ctx.fillStyle = 'rgba(255, 215, 0, 0.95)';
      this.ctx.strokeStyle = '#000';
      this.ctx.lineWidth = 1.5;
      const r = this.anchorRadius();
      for (const a of pts) {
        this.ctx.beginPath();
        this.ctx.arc(a.x + this.padX, a.y + this.padY, r, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  private drawCursorPreview(): void {
    if (!this.ctx) return;
    if (this.cursorCanvasX === null || this.cursorCanvasY === null) return;
    if (this.viewMode === 'before') return;
    // Lasso doesn't need a size indicator — the pointer caret is enough.
    if (this.tool === 'lasso') return;

    this.ctx.save();
    this.ctx.strokeStyle = this.tool === 'eraser' ? 'rgba(255, 80, 80, 0.95)' : 'rgba(255, 215, 0, 0.95)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.arc(this.cursorCanvasX, this.cursorCanvasY, this.brushRadius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
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
