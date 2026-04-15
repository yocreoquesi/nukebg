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
import { createLoader, type ModelLoader } from '../../exploration/loaders';
import { processRoi } from '../../exploration/roi-process';
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

// View transform. 1 = natural fit (max-width / max-height); zoom multiplies
// that via a CSS transform on the canvas. Keep in sync with ar-editor.ts.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.15;

type Tool = 'brush' | 'eraser' | 'lasso';
type LassoAction = 'crop' | 'refine' | 'erase-object';

interface PendingPreview {
  kind: LassoAction;
  /** Full-image alpha buffer to apply on confirm. Working buffer is unchanged. */
  newAlpha: Uint8Array;
  /** Cached tint overlay (image-sized) the display canvas composites on top. */
  overlay: HTMLCanvasElement;
}

export class ArEditorAdvanced extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private current: ImageData | null = null;
  private original: ImageData | null = null;

  // Backing buffers at image resolution (no padding).
  private working: HTMLCanvasElement | null = null;
  private originalBacking: HTMLCanvasElement | null = null;

  private tool: Tool = 'eraser';
  private brushRadius = DEFAULT_BRUSH;

  private padX = 0;
  private padY = 0;

  private drawing = false;
  private lastImgX = 0;
  private lastImgY = 0;
  private cursorCanvasX: number | null = null;
  private cursorCanvasY: number | null = null;

  // View transform: CSS `transform: translate(panX, panY) scale(zoom)` is
  // applied to the canvas. Default = 1 / 0 / 0 means "natural fit, centered".
  // Coordinate math in eventToImageCoords stays zoom-agnostic because
  // getBoundingClientRect already returns the post-transform rect.
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  // Middle-click pan bookkeeping.
  private panning = false;
  private lastPanClientX = 0;
  private lastPanClientY = 0;

  // Touch pinch tracking. We avoid setPointerCapture during pinch so both
  // fingers keep generating events.
  private lastPinchDist = 0;
  private pinching = false;

  // Lasso state (all coordinates in image-space — may be outside [0..w/h]
  // because the canvas is padded and loops can cross the image edge).
  private lassoRaw: Point[] | null = null;
  private lassoAnchors: Point[] | null = null;
  private dragAnchorIndex: number | null = null;

  // Shared RMBG-1.4 loader, warmed on first refine and reused afterwards.
  private loader: ModelLoader | null = null;
  private busy = false;

  // Pending action awaiting user confirmation. While set, the display shows
  // a red/green tint overlay on top of the working buffer; only Apply writes
  // the new alpha to the buffer.
  private pendingPreview: PendingPreview | null = null;

  // Undo/redo stacks of full RGBA snapshots (Uint8ClampedArray, image size).
  // Full snapshots match ar-editor's pattern — simple, robust, and still
  // cheap to swap in. Depth is budget-capped per-image so we don't OOM on
  // 20-100MP payloads; see `computeMaxHistory`.
  private undoStack: Uint8ClampedArray[] = [];
  private redoStack: Uint8ClampedArray[] = [];
  private maxHistory = 8;

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
    this.clearLasso();
    this.rebuildBackingBuffers();
    this.resetHistory();
    this.syncToolUI();
    this.paintCanvas();
    this.resetView();
  }

  private computeMaxHistory(w: number, h: number): number {
    const bytesPerSnapshot = w * h * 4;
    // Hard cap at ~200MB total snapshot budget; keep at least 2 so undo
    // always has some useful depth even on 100MP images.
    const budget = 200 * 1024 * 1024;
    return Math.max(2, Math.min(8, Math.floor(budget / Math.max(1, bytesPerSnapshot))));
  }

  private resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    if (this.current) {
      this.maxHistory = this.computeMaxHistory(this.current.width, this.current.height);
    }
    this.syncHistoryUI();
  }

  private snapshotWorking(): Uint8ClampedArray | null {
    if (!this.working || !this.current) return null;
    const w = this.current.width;
    const h = this.current.height;
    const data = this.working.getContext('2d')!.getImageData(0, 0, w, h).data;
    return new Uint8ClampedArray(data);
  }

  private restoreWorking(rgba: Uint8ClampedArray): void {
    if (!this.working || !this.current) return;
    const w = this.current.width;
    const h = this.current.height;
    const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
    this.working.getContext('2d')!.putImageData(img, 0, 0);
  }

  private pushUndo(): void {
    const snap = this.snapshotWorking();
    if (!snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    // Any new action invalidates the redo branch.
    this.redoStack = [];
    this.syncHistoryUI();
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;
    const before = this.undoStack.pop()!;
    const after = this.snapshotWorking();
    if (after) this.redoStack.push(after);
    this.restoreWorking(before);
    this.clearLasso();
    this.redrawDisplay();
    this.syncHistoryUI();
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    const current = this.snapshotWorking();
    if (current) this.undoStack.push(current);
    this.restoreWorking(next);
    this.clearLasso();
    this.redrawDisplay();
    this.syncHistoryUI();
  }

  private syncHistoryUI(): void {
    const undoBtn = this.shadowRoot?.getElementById('undo') as HTMLButtonElement | null;
    const redoBtn = this.shadowRoot?.getElementById('redo') as HTMLButtonElement | null;
    // Lock history during async actions — an in-flight ML segmentation would
    // finish after an undo and overwrite the rolled-back buffer.
    if (undoBtn) undoBtn.disabled = this.busy || this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.busy || this.redoStack.length === 0;
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
        .restore-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: background 0.15s, color 0.15s;
        }
        .restore-btn:hover:not(:disabled) {
          background: var(--color-accent, #ffd700);
          color: #000;
        }
        .restore-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .header-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .help-btn {
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          background: transparent;
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 50%;
          width: 22px;
          height: 22px;
          padding: 0;
          cursor: pointer;
          line-height: 1;
          transition: background 0.15s, color 0.15s;
        }
        .help-btn:hover,
        .help-btn[aria-expanded="true"] {
          background: var(--color-accent, #ffd700);
          color: #000;
        }
        .help-panel {
          margin-bottom: 8px;
          padding: 10px 12px;
          border: 1px solid rgba(255, 215, 0, 0.35);
          border-radius: 3px;
          background: rgba(255, 215, 0, 0.03);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
        }
        .help-panel.hidden { display: none; }
        .help-section h4 {
          margin: 0 0 6px 0;
          font-size: 10px;
          color: var(--color-accent, #ffd700);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .help-subhead {
          font-size: 10px;
          color: var(--color-text-secondary, #999);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 8px 0 4px 0;
        }
        .help-section dl {
          margin: 0;
          display: grid;
          grid-template-columns: max-content 1fr;
          column-gap: 10px;
          row-gap: 4px;
          align-items: baseline;
        }
        .help-section dt {
          font-size: 11px;
          color: var(--color-text, #ddd);
          white-space: nowrap;
        }
        .help-section dd {
          margin: 0;
          font-size: 11px;
          color: var(--color-text-tertiary, #888);
          line-height: 1.4;
        }
        .help-section kbd {
          display: inline-block;
          padding: 1px 5px;
          border: 1px solid rgba(255, 215, 0, 0.45);
          border-bottom-width: 2px;
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.35);
          color: var(--color-text, #ddd);
          font-family: inherit;
          font-size: 10px;
          line-height: 1;
        }
        .help-note {
          margin: 8px 0 0 0;
          padding: 6px 8px;
          border-left: 2px solid var(--color-accent, #ffd700);
          background: rgba(255, 215, 0, 0.05);
          font-size: 10px;
          color: var(--color-text-secondary, #999);
          line-height: 1.4;
        }
        /* Detect touch-primary devices — hide desktop controls there. */
        .help-controls-touch { display: none; }
        @media (pointer: coarse) {
          .help-controls-desktop { display: none; }
          .help-controls-touch { display: block; }
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
        .lasso-actions {
          display: none;
          gap: 6px;
          align-items: center;
        }
        .lasso-actions.visible { display: inline-flex; }
        .action-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: background 0.15s, color 0.15s;
        }
        .action-btn:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .action-btn.danger {
          color: #ff6d6d;
          border-color: #ff6d6d;
        }
        .action-btn.danger:hover:not(:disabled) { background: #ff6d6d; color: #000; }
        .action-btn.confirm {
          color: #7bd37b;
          border-color: #7bd37b;
        }
        .action-btn.confirm:hover:not(:disabled) { background: #7bd37b; color: #000; }
        .preview-actions {
          display: none;
          gap: 6px;
          align-items: center;
        }
        .preview-actions.visible { display: inline-flex; }
        .busy-indicator {
          font-size: 10px;
          color: var(--color-accent, #ffd700);
          margin-left: 6px;
        }
        .busy-indicator.hidden { display: none; }
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
          max-height: 70vh;
          position: relative;
          overflow: hidden;
        }
        canvas {
          max-width: 100%;
          max-height: 70vh;
          display: block;
          touch-action: none;
          cursor: crosshair;
          transform-origin: center center;
          will-change: transform;
        }
        canvas.disabled { cursor: not-allowed; }
        canvas.panning { cursor: grabbing; }
        .zoom-group {
          display: inline-flex;
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          overflow: hidden;
          margin-left: auto;
        }
        .zoom-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent, #ffd700);
          border: none;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          min-width: 28px;
          text-align: center;
        }
        .zoom-btn + .zoom-btn { border-left: 1px solid var(--color-accent, #ffd700); }
        .zoom-btn:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        .zoom-display {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-text, #ddd);
          border: none;
          padding: 4px 8px;
          min-width: 44px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          pointer-events: none;
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
        <div class="title">${t('advanced.title')}</div>
        <div class="header-actions">
          <button type="button" class="help-btn" id="help-toggle" title="${t('advanced.help')}" aria-label="${t('advanced.help')}" aria-expanded="false">?</button>
          <button type="button" class="restore-btn" id="restore-original" title="${t('advanced.restoreHint')}">${t('advanced.restore')}</button>
        </div>
      </div>
      <div class="help-panel hidden" id="help-panel" role="region" aria-label="${t('advanced.helpTitle')}">
        <div class="help-section">
          <h4>${t('advanced.helpTools')}</h4>
          <dl>
            <dt>${t('advanced.toolBrush')}</dt><dd>${t('advanced.helpBrushDesc')}</dd>
            <dt>${t('advanced.toolEraser')}</dt><dd>${t('advanced.helpEraserDesc')}</dd>
            <dt>${t('advanced.toolLasso')}</dt><dd>${t('advanced.helpLassoDesc')}</dd>
          </dl>
        </div>
        <div class="help-section">
          <h4>${t('advanced.helpActions')}</h4>
          <dl>
            <dt>${t('advanced.actionCrop')}</dt><dd>${t('advanced.actionCropHint')}</dd>
            <dt>${t('advanced.actionRefine')}</dt><dd>${t('advanced.actionRefineHint')}</dd>
            <dt>${t('advanced.actionEraseObject')}</dt><dd>${t('advanced.actionEraseObjectHint')}</dd>
          </dl>
          <p class="help-note">${t('advanced.helpPreviewNote')}</p>
        </div>
        <div class="help-section">
          <h4>${t('advanced.helpControls')}</h4>
          <div class="help-controls-desktop">
            <div class="help-subhead">${t('advanced.helpControlsDesktop')}</div>
            <dl class="shortcut-list">
              <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd></dt><dd>${t('advanced.keyUndo')}</dd>
              <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></dt><dd>${t('advanced.keyRedo')}</dd>
              <dt><kbd>Esc</kbd></dt><dd>${t('advanced.keyClearLasso')}</dd>
              <dt><kbd>0</kbd></dt><dd>${t('advanced.keyResetZoom')}</dd>
              <dt><kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>−</kbd></dt><dd>${t('advanced.keyZoom')}</dd>
              <dt><kbd>[</kbd> / <kbd>]</kbd></dt><dd>${t('advanced.keyBrushSize')}</dd>
              <dt>Wheel</dt><dd>${t('advanced.keyZoom')}</dd>
              <dt>Middle-click drag</dt><dd>${t('advanced.keyPan')}</dd>
              <dt>Double-click</dt><dd>${t('advanced.keyDeleteAnchor')}</dd>
            </dl>
          </div>
          <div class="help-controls-touch">
            <div class="help-subhead">${t('advanced.helpControlsTouch')}</div>
            <dl class="shortcut-list">
              <dt>${t('advanced.gestureOneFinger')}</dt><dd>${t('advanced.gestureDraw')}</dd>
              <dt>${t('advanced.gesturePinch')}</dt><dd>${t('advanced.gestureZoom')}</dd>
              <dt>${t('advanced.gestureDoubleTap')}</dt><dd>${t('advanced.keyDeleteAnchor')}</dd>
            </dl>
          </div>
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
        <div class="lasso-actions" id="lasso-actions" role="group" aria-label="Lasso actions">
          <button type="button" class="action-btn" id="action-crop" title="${t('advanced.actionCropHint')}">${t('advanced.actionCrop')}</button>
          <button type="button" class="action-btn" id="action-refine" title="${t('advanced.actionRefineHint')}">${t('advanced.actionRefine')}</button>
          <button type="button" class="action-btn danger" id="action-erase-object" title="${t('advanced.actionEraseObjectHint')}">${t('advanced.actionEraseObject')}</button>
          <span class="busy-indicator hidden" id="busy">${t('advanced.working')}</span>
        </div>
        <div class="preview-actions" id="preview-actions" role="group" aria-label="Confirm preview">
          <button type="button" class="action-btn confirm" id="action-apply-preview" title="${t('advanced.previewApplyHint')}">${t('advanced.previewApply')}</button>
          <button type="button" class="action-btn" id="action-cancel-preview" title="${t('advanced.previewCancelHint')}">${t('advanced.previewCancel')}</button>
        </div>
        <div class="zoom-group" role="group" aria-label="${t('advanced.zoom')}">
          <button type="button" class="zoom-btn" id="zoom-out" title="${t('advanced.zoomOut')}" aria-label="${t('advanced.zoomOut')}">−</button>
          <span class="zoom-display" id="zoom-display">100%</span>
          <button type="button" class="zoom-btn" id="zoom-in" title="${t('advanced.zoomIn')}" aria-label="${t('advanced.zoomIn')}">+</button>
          <button type="button" class="zoom-btn" id="zoom-fit" title="${t('advanced.zoomFit')}" aria-label="${t('advanced.zoomFit')}">⌂</button>
        </div>
      </div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint" id="hint">${t('advanced.hint')}</span>
        <button type="button" class="action secondary" id="undo" disabled>${t('advanced.undo')}</button>
        <button type="button" class="action secondary" id="redo" disabled>${t('advanced.redo')}</button>
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
    shadow.getElementById('restore-original')!.addEventListener('click', () => this.restoreToOriginal(), { signal });
    shadow.getElementById('help-toggle')!.addEventListener('click', () => this.toggleHelp(), { signal });
    shadow.getElementById('tool-brush')!.addEventListener('click', () => this.setTool('brush'), { signal });
    shadow.getElementById('tool-eraser')!.addEventListener('click', () => this.setTool('eraser'), { signal });
    shadow.getElementById('tool-lasso')!.addEventListener('click', () => this.setTool('lasso'), { signal });
    shadow.getElementById('action-crop')!.addEventListener('click', () => this.previewAction('crop'), { signal });
    shadow.getElementById('action-refine')!.addEventListener('click', () => this.previewAction('refine'), { signal });
    shadow.getElementById('action-erase-object')!.addEventListener('click', () => this.previewAction('erase-object'), { signal });
    shadow.getElementById('action-apply-preview')!.addEventListener('click', () => this.applyPreview(), { signal });
    shadow.getElementById('action-cancel-preview')!.addEventListener('click', () => this.cancelPreview(), { signal });
    shadow.getElementById('undo')!.addEventListener('click', () => this.undo(), { signal });
    shadow.getElementById('redo')!.addEventListener('click', () => this.redo(), { signal });
    shadow.getElementById('zoom-in')!.addEventListener('click', () => this.setZoom(this.zoom * ZOOM_STEP), { signal });
    shadow.getElementById('zoom-out')!.addEventListener('click', () => this.setZoom(this.zoom / ZOOM_STEP), { signal });
    shadow.getElementById('zoom-fit')!.addEventListener('click', () => this.resetView(), { signal });

    const wrap = shadow.querySelector('.canvas-wrap') as HTMLElement;
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      this.setZoom(this.zoom * factor);
    }, { passive: false, signal });

    // Pinch-to-zoom via native touch events. We use touch events (not
    // pointer events) because setPointerCapture in onPointerDown would
    // eat the second finger. touchstart.preventDefault suppresses the
    // synthesized pointer sequence, so drawing pointer events won't fire
    // while two fingers are down.
    wrap.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false, signal });
    wrap.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false, signal });
    wrap.addEventListener('touchend', () => this.onTouchEnd(), { signal });
    wrap.addEventListener('touchcancel', () => this.onTouchEnd(), { signal });

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
      // If pointer leaves without an up event (rare under capture, but
      // happens on some touch → synthetic-mouse paths), flush any pan
      // state so the cursor doesn't stay locked in "grabbing" style.
      if (this.panning) {
        this.panning = false;
        if (this.canvas) this.canvas.classList.remove('panning');
      }
      this.redrawDisplay();
    }, { signal });
    c.addEventListener('dblclick', (e) => this.onDblClick(e), { signal });
  }

  private attachKeyboardHandlers(signal: AbortSignal): void {
    window.addEventListener('keydown', (e) => {
      if (!this.hasAttribute('active')) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (this.busy) return;
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (this.busy) return;
        this.redo();
        return;
      }

      if (e.key === 'Escape') {
        if (this.lassoAnchors || this.lassoRaw) {
          e.preventDefault();
          this.clearLasso();
          this.redrawDisplay();
        }
        return;
      }
      if (e.key === '0' || e.key === 'Home') {
        e.preventDefault();
        this.resetView();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.setZoom(this.zoom * ZOOM_STEP);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        this.setZoom(this.zoom / ZOOM_STEP);
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
    if (!this.canvas) return;

    // Middle-click pan works regardless of view mode or tool.
    if (e.button === 1) {
      e.preventDefault();
      this.panning = true;
      this.lastPanClientX = e.clientX;
      this.lastPanClientY = e.clientY;
      this.canvas.classList.add('panning');
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      return;
    }

    if (this.pinching) return;
    const [ix, iy] = this.eventToImageCoords(e);
    this.updateCursor(e);

    if (this.tool === 'lasso') {
      // Any interaction with the lasso while a preview is pending voids it —
      // the preview was computed for a specific polygon shape, so moving
      // anchors or starting a new stroke invalidates it.
      if (this.pendingPreview) this.cancelPreview();
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

    // brush / eraser — snapshot BEFORE the first stamp so undo takes us
    // back to the state at the instant the user pressed down.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    this.pushUndo();
    this.drawing = true;
    this.lastImgX = ix;
    this.lastImgY = iy;
    this.applyStrokeSegment(ix, iy, ix, iy);
    this.redrawDisplay();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.panning) {
      const dx = e.clientX - this.lastPanClientX;
      const dy = e.clientY - this.lastPanClientY;
      this.lastPanClientX = e.clientX;
      this.lastPanClientY = e.clientY;
      this.panX += dx;
      this.panY += dy;
      this.applyTransform();
      return;
    }
    if (this.pinching) return;

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

    if (!this.drawing) {
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

    if (this.panning) {
      this.panning = false;
      this.canvas.classList.remove('panning');
      return;
    }

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
      this.syncLassoActionsUI();
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
    this.syncLassoActionsUI();
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

  private applyTransform(): void {
    if (!this.canvas) return;
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  private setZoom(z: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    this.applyTransform();
    this.updateZoomDisplay();
  }

  private resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
    this.updateZoomDisplay();
  }

  private updateZoomDisplay(): void {
    const el = this.shadowRoot?.getElementById('zoom-display');
    if (el) el.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private getPinchDist(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 2) return;
    // Two fingers down: start pinch-to-zoom, suppress pointer draw path.
    e.preventDefault();
    this.pinching = true;
    this.lastPinchDist = this.getPinchDist(e.touches);
    // Cancel any brush stroke that might have started on the first touch.
    this.drawing = false;
    this.dragAnchorIndex = null;
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 2 || !this.pinching) return;
    e.preventDefault();
    const dist = this.getPinchDist(e.touches);
    if (this.lastPinchDist > 0) {
      const scale = dist / this.lastPinchDist;
      this.setZoom(this.zoom * scale);
    }
    this.lastPinchDist = dist;
  }

  private onTouchEnd(): void {
    this.pinching = false;
    this.lastPinchDist = 0;
  }

  private toggleHelp(): void {
    const panel = this.shadowRoot?.getElementById('help-panel');
    const btn = this.shadowRoot?.getElementById('help-toggle');
    if (!panel || !btn) return;
    const open = panel.classList.toggle('hidden');
    // toggle returns the new state of the class — true = hidden was just added.
    const nowOpen = !open;
    btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
  }

  private restoreToOriginal(): void {
    if (this.busy) return;
    if (!this.working || !this.original) return;
    // Destructive — ask once. undo stack captures the pre-restore state so
    // Ctrl+Z still gets them back if they changed their mind after confirming.
    if (!window.confirm(t('advanced.restoreConfirm'))) return;
    this.pushUndo();
    const wctx = this.working.getContext('2d')!;
    wctx.putImageData(this.original, 0, 0);
    this.clearLasso();
    this.redrawDisplay();
  }

  private setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.syncToolUI();
    this.redrawDisplay();
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
    if (hint && this.tool !== 'lasso') hint.textContent = t('advanced.hint');
    this.syncLassoActionsUI();
  }

  private syncLassoActionsUI(): void {
    const row = this.shadowRoot?.getElementById('lasso-actions');
    const previewRow = this.shadowRoot?.getElementById('preview-actions');
    const busy = this.shadowRoot?.getElementById('busy');
    const hint = this.shadowRoot?.getElementById('hint');
    if (!row || !previewRow) return;
    const hasAnchors =
      this.tool === 'lasso' && this.lassoAnchors !== null && this.lassoAnchors.length >= MIN_ANCHORS;
    const isPreviewing = this.pendingPreview !== null;
    // Action row: visible only when we have anchors AND no preview pending.
    row.classList.toggle('visible', hasAnchors && !isPreviewing);
    row.querySelectorAll<HTMLButtonElement>('button.action-btn').forEach((b) => {
      b.disabled = this.busy;
    });
    if (busy) busy.classList.toggle('hidden', !this.busy);
    // Preview row: visible only while a preview is staged.
    previewRow.classList.toggle('visible', isPreviewing);
    previewRow.querySelectorAll<HTMLButtonElement>('button.action-btn').forEach((b) => {
      b.disabled = this.busy;
    });
    // Hint follows the lasso state: base hint while selecting, preview hint
    // while awaiting confirm. Non-lasso tools set their own hint in syncToolUI.
    if (hint && this.tool === 'lasso') {
      hint.textContent = isPreviewing ? t('advanced.previewHint') : t('advanced.hintLasso');
    }
  }

  private clearLasso(): void {
    this.lassoRaw = null;
    this.lassoAnchors = null;
    this.dragAnchorIndex = null;
    this.pendingPreview = null;
    this.syncLassoActionsUI();
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
    if (this.working) this.ctx.drawImage(this.working, this.padX, this.padY);
    if (this.pendingPreview) {
      this.ctx.drawImage(this.pendingPreview.overlay, this.padX, this.padY);
    }
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

  /**
   * Run RMBG on the lasso region and stage the result as a pending preview:
   * working buffer is NOT modified — the display renders a red/green tint
   * overlay so the user can confirm or cancel before the action is committed.
   */
  private async previewAction(kind: LassoAction): Promise<void> {
    if (this.busy) return;
    if (!this.lassoAnchors || this.lassoAnchors.length < MIN_ANCHORS) return;
    if (!this.working || !this.original || !this.current) return;
    // If there was a stale preview, drop it — the new action supersedes it.
    this.pendingPreview = null;

    const w = this.current.width;
    const h = this.current.height;

    this.busy = true;
    this.syncLassoActionsUI();
    this.syncHistoryUI();
    try {
      const wctx = this.working.getContext('2d')!;
      const prevData = wctx.getImageData(0, 0, w, h).data;
      const prevAlpha = new Uint8Array(w * h);
      for (let i = 0; i < prevAlpha.length; i++) prevAlpha[i] = prevData[i * 4 + 3];

      const segment = async (pixels: Uint8ClampedArray, pw: number, ph: number) => {
        const loader = await this.getLoader();
        const res = await loader.segment({ pixels, width: pw, height: ph });
        return res.alpha;
      };

      const result = await processRoi({
        original: this.original,
        polygon: this.lassoAnchors,
        previousAlpha: prevAlpha,
        mode: kind,
        segment,
      });

      const overlay = this.buildPreviewOverlay(prevAlpha, result.alpha, w, h);
      this.pendingPreview = { kind, newAlpha: result.alpha, overlay };
      this.redrawDisplay();
    } catch (err) {
      console.error('[ar-editor-advanced] preview failed', err);
      const hint = this.shadowRoot?.getElementById('hint');
      if (hint) hint.textContent = t('advanced.refineError');
    } finally {
      this.busy = false;
      this.syncLassoActionsUI();
      this.syncHistoryUI();
    }
  }

  /**
   * Render a transparent canvas the size of the image where pixels that will
   * LOSE alpha are tinted red and pixels that will GAIN alpha are tinted green.
   * Cached on the preview so it doesn't recompute on every redraw (panning,
   * cursor updates, etc.).
   */
  private buildPreviewOverlay(
    prevAlpha: Uint8Array,
    newAlpha: Uint8Array,
    w: number,
    h: number,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < prevAlpha.length; i++) {
      const delta = newAlpha[i] - prevAlpha[i];
      const idx = i * 4;
      if (delta <= -24) {
        // Will be erased — red tint.
        img.data[idx] = 255;
        img.data[idx + 1] = 60;
        img.data[idx + 2] = 60;
        img.data[idx + 3] = 140;
      } else if (delta >= 24) {
        // Will be restored — green tint.
        img.data[idx] = 80;
        img.data[idx + 1] = 220;
        img.data[idx + 2] = 120;
        img.data[idx + 3] = 110;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private applyPreview(): void {
    if (!this.pendingPreview || !this.working || !this.current || !this.original) return;
    const { newAlpha } = this.pendingPreview;
    // Committing is a single undo step — match brush/eraser contract.
    this.pushUndo();
    const w = this.current.width;
    const h = this.current.height;
    const wctx = this.working.getContext('2d')!;
    const img = wctx.getImageData(0, 0, w, h);
    const orig = this.original.data;
    for (let i = 0; i < newAlpha.length; i++) {
      const dstIdx = i * 4;
      const prevA = img.data[dstIdx + 3];
      const nextA = newAlpha[i];
      // Canvas destination-out (how the eraser cuts alpha) also zeroes RGB,
      // so erased pixels sit at (0,0,0,0). When a later action brings alpha
      // back, we'd see black unless we refresh RGB from the original here.
      if (prevA === 0 && nextA > 0) {
        img.data[dstIdx] = orig[dstIdx];
        img.data[dstIdx + 1] = orig[dstIdx + 1];
        img.data[dstIdx + 2] = orig[dstIdx + 2];
      }
      img.data[dstIdx + 3] = nextA;
    }
    wctx.putImageData(img, 0, 0);
    this.pendingPreview = null;
    this.clearLasso();
    this.redrawDisplay();
    this.syncHistoryUI();
  }

  private cancelPreview(): void {
    if (!this.pendingPreview) return;
    this.pendingPreview = null;
    // Keep the lasso around so the user can try a different action without
    // redrawing the loop.
    this.redrawDisplay();
    this.syncLassoActionsUI();
  }

  private async getLoader(): Promise<ModelLoader> {
    if (this.loader) return this.loader;
    const loader = createLoader('rmbg-1.4');
    await loader.warmup();
    this.loader = loader;
    return loader;
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
