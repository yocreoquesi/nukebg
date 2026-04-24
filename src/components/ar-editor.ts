/**
 * ar-editor: Canvas-based eraser tool for manual alpha cleanup.
 * Operates directly on the alpha channel of the result image.
 * Features: brush eraser (circle/square), zoom, pan, undo/redo.
 */

import { t } from '../i18n';

type BrushShape = 'circle' | 'square';

interface HistoryEntry {
  // Full RGBA snapshot. Needed because the Restore tool writes RGB (not just
  // alpha); alpha-only snapshots cannot undo color changes. Bounded by
  // maxHistory to keep memory predictable on large images.
  rgba: Uint8ClampedArray;
}

/** Generate a CSS cursor data URL that matches the brush shape, size and tool */
function makeBrushCursor(
  size: number,
  shape: BrushShape,
  zoom: number,
  tool: 'erase' | 'restore' = 'erase',
): string {
  const raw = size * zoom;
  // Defensive: Number.isFinite guards against NaN from upstream state bugs.
  // Math.round(NaN) → NaN, which poisons min/max and produces a NaN-sized SVG.
  const displaySize = Number.isFinite(raw)
    ? Math.min(64, Math.max(8, Math.round(raw)))
    : 32;
  const r = displaySize / 2;
  const svgSize = displaySize + 2; // 1px padding
  const center = svgSize / 2;
  // Erase stays green (default brand accent); Restore is cyan so the user
  // can tell at a glance which tool is active. Both colors resolved from CSS
  // vars so power-mode theme switching cascades into the cursor.
  const rootStyle = getComputedStyle(document.documentElement);
  const accentRgb = rootStyle.getPropertyValue('--color-accent-rgb').trim() || '0, 255, 65';
  const restoreRgb = rootStyle.getPropertyValue('--color-restore-rgb').trim() || '0, 212, 255';
  const stroke = tool === 'restore' ? `rgb(${restoreRgb})` : `rgb(${accentRgb})`;

  let shapeEl: string;
  if (shape === 'circle') {
    shapeEl = `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="0.9"/>
               <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="black" stroke-width="0.5" opacity="0.5"/>`;
  } else {
    const half = r;
    shapeEl = `<rect x="${center - half}" y="${center - half}" width="${half * 2}" height="${half * 2}" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="0.9"/>
               <rect x="${center - half}" y="${center - half}" width="${half * 2}" height="${half * 2}" fill="none" stroke="black" stroke-width="0.5" opacity="0.5"/>`;
  }

  // Crosshair at center
  const cross = `<line x1="${center}" y1="${center-3}" x2="${center}" y2="${center+3}" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>
                 <line x1="${center-3}" y1="${center}" x2="${center+3}" y2="${center}" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}">${shapeEl}${cross}</svg>`;
  const encoded = encodeURIComponent(svg);
  return `url("data:image/svg+xml,${encoded}") ${Math.round(center)} ${Math.round(center)}, crosshair`;
}

export class ArEditor extends HTMLElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private checkerCanvas!: HTMLCanvasElement;
  private tempCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  // Image state
  private imageData: ImageData | null = null;
  // Pre-segmentation image — used by the Restore tool to bring back RGBA
  // pixels that were wrongly wiped out (e.g. interior holes where the
  // subject shared the background color).
  private originalImage: ImageData | null = null;
  private width = 0;
  private height = 0;

  // View state
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  // Brush state
  private brushSize = 20;
  private brushShape: BrushShape = 'circle';
  private tool: 'erase' | 'restore' = 'erase';
  private isErasing = false;

  // Background preview
  private editorBg = 'checker';

  // Touch state
  private touchIndicator: HTMLDivElement | null = null;
  private lastPinchDist = 0;
  private isTouchErasing = false;

  // History
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  // Full-RGBA snapshots × maxHistory — budget this conservatively so large
  // images (up to 4096² ≈ 67 MB per entry) don't blow RAM.
  private maxHistory = 12;
  private boundLocaleHandler: (() => void) | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.abortController = new AbortController();
    this.render();
    this.setupCanvas();
    this.setupEvents();
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  disconnectedCallback(): void {
    if (this.boundLocaleHandler) document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
    this.abortController?.abort();
    this.abortController = null;
  }

  private updateTexts(): void {
    const root = this.shadowRoot!;
    const toolLabel = root.querySelector('#ed-tool-label');
    if (toolLabel) toolLabel.textContent = t('editor.tool');
    const toolSelect = root.querySelector('#brush-tool') as HTMLSelectElement | null;
    if (toolSelect) {
      const opts = toolSelect.options;
      if (opts[0]) opts[0].textContent = t('editor.eraser');
      if (opts[1]) opts[1].textContent = t('editor.restore');
    }
    const brushLabel = root.querySelector('#ed-brush-label');
    if (brushLabel) brushLabel.textContent = t('editor.shape');
    const brushSelect = root.querySelector('#brush-shape') as HTMLSelectElement | null;
    if (brushSelect) {
      const opts = brushSelect.options;
      if (opts[0]) opts[0].textContent = t('editor.eraserCircle');
      if (opts[1]) opts[1].textContent = t('editor.eraserSquare');
    }
    const sizeLabel = root.querySelector('#ed-size-label');
    if (sizeLabel) sizeLabel.textContent = t('editor.eraserSize');
    const undoBtn = root.querySelector('#undo-btn');
    if (undoBtn) undoBtn.textContent = t('editor.undo');
    const redoBtn = root.querySelector('#redo-btn');
    if (redoBtn) redoBtn.textContent = t('editor.redo');
    const fitBtn = root.querySelector('#zoom-fit');
    if (fitBtn) fitBtn.textContent = t('editor.zoomFit');
    const cancelBtn = root.querySelector('#cancel-btn');
    if (cancelBtn) cancelBtn.textContent = t('editor.cancel');
    const doneBtn = root.querySelector('#done-btn');
    if (doneBtn) doneBtn.textContent = t('editor.apply');
    const bgLabel = root.querySelector('#ed-bg-label');
    if (bgLabel) bgLabel.textContent = t('editor.bg');
    // Shortcuts tooltip
    const tooltip = root.querySelector('#help-tooltip');
    if (tooltip) {
      tooltip.innerHTML = `
        <strong>${t('editor.shortcuts')}</strong><br>
        <kbd>Click</kbd> ${t('editor.shortcutErase')}<br>
        <kbd>[ ]</kbd> ${t('editor.shortcutEraserSize')}<br>
        <kbd>Scroll</kbd> ${t('editor.shortcutZoom')}<br>
        <kbd>Middle drag</kbd> ${t('editor.shortcutPan')}<br>
        <kbd>0</kbd> ${t('editor.shortcutResetView')}<br>
        <kbd>Ctrl+Z</kbd> ${t('editor.shortcutUndo')}<br>
        <kbd>Ctrl+Shift+Z</kbd> ${t('editor.shortcutRedo')}
      `;
    }
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .editor-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 0.5rem);
        }
        .toolbar {
          display: flex;
          align-items: center;
          gap: var(--space-3, 0.75rem);
          padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          flex-wrap: wrap;
        }
        .zoom-group {
          flex: 0 0 100%;
          display: flex;
          align-items: center;
          gap: var(--space-3, 0.75rem);
        }
        .toolbar label {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
        }
        .toolbar select, .toolbar input[type="range"] {
          background: var(--color-bg-secondary, #0a0a0a);
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 2px 6px;
          font-size: var(--text-xs, 0.75rem);
          font-family: 'JetBrains Mono', monospace;
        }
        .toolbar input[type="range"] {
          width: 100px;
          accent-color: var(--color-accent-primary, #00ff41);
        }
        .size-display {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
          min-width: 32px;
          text-align: center;
        }
        .toolbar-btn {
          background: var(--color-bg-secondary, #0a0a0a);
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 4px 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .toolbar-btn:hover {
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.05);
          border-color: var(--color-accent-primary, #00ff41);
        }
        .toolbar-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .toolbar-btn.primary {
          background: var(--color-accent-primary, #00ff41);
          color: var(--color-text-inverse, #000);
          border-color: var(--color-accent-primary, #00ff41);
        }
        .toolbar-btn.primary:hover {
          background: var(--color-accent-hover, #33ff66);
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.3);
        }
        .help-wrap {
          position: relative;
        }
        .help-tooltip {
          display: none;
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 8px;
          background: var(--color-bg-secondary, #0a0a0a);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 12px 16px;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-secondary, #00dd44);
          font-family: 'JetBrains Mono', monospace;
          line-height: 1.8;
          white-space: nowrap;
          z-index: 20;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        }
        .help-tooltip.visible { display: block; }
        .help-tooltip strong {
          color: var(--color-accent-primary, #00ff41);
          font-size: var(--text-sm, 0.875rem);
        }
        .help-tooltip kbd {
          display: inline-block;
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 1px 5px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-accent-primary, #00ff41);
          margin-right: 6px;
          min-width: 40px;
          text-align: center;
        }
        .separator {
          width: 1px;
          height: 20px;
          background: var(--color-surface-border, #1a3a1a);
        }
        /* Editor command bar above the canvas (#76 sub-task C).
           Mirrors the ar-app workspace command bar pattern so the
           vocabulary stays consistent: $ action · meta · [cancel] [apply]. */
        .editor-cmd-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          margin-bottom: 10px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          min-height: 40px;
          flex-wrap: wrap;
        }
        .editor-cmd-left {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--color-text-secondary, #00dd44);
          min-width: 0;
          flex: 1 1 auto;
        }
        .editor-cmd-prompt { color: var(--color-text-tertiary, #00b34a); }
        .editor-cmd-action { color: var(--color-accent-primary, #00ff41); font-weight: 600; }
        .editor-cmd-meta { color: var(--color-text-tertiary, #00b34a); }
        .editor-cmd-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .editor-cmd-btn {
          font: inherit;
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 4px 10px;
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          cursor: pointer;
          min-height: 32px;
          transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        }
        .editor-cmd-btn:hover:not(:disabled),
        .editor-cmd-btn:focus-visible {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          outline: none;
        }
        .editor-cmd-btn-primary {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.05);
        }
        .editor-cmd-btn-primary:hover:not(:disabled),
        .editor-cmd-btn-primary:focus-visible {
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.12);
          box-shadow: 0 0 8px var(--color-accent-glow, rgba(0, 255, 65, 0.25));
        }
        @media (pointer: coarse) {
          .editor-cmd-btn { min-height: 44px; min-width: 88px; }
        }
        @media (max-width: 480px) {
          .editor-cmd-bar { padding: 6px 10px; gap: 8px; }
        }
        /* Editor body — canvas + optional sidebar at ≥ 900 px.
           Single column below that breakpoint, the shortcuts move
           back behind the "?" tooltip. (#76 sub-task B) */
        .editor-body {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-3, 0.75rem);
          align-items: start;
        }
        @media (min-width: 900px) {
          .editor-body {
            grid-template-columns: 200px minmax(0, 1fr) 260px;
          }
        }
        /* Left rail (#76 sub-task A). Vertical column at ≥ 900 px,
           horizontal strip below so mobile keeps single-row flow. */
        .editor-rail {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          align-content: start;
        }
        @media (min-width: 900px) {
          .editor-rail {
            flex-direction: column;
            flex-wrap: nowrap;
          }
        }
        .editor-rail-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .editor-rail-label {
          color: var(--color-text-tertiary, #00b34a);
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .editor-rail-select,
        .editor-rail-range {
          font-family: inherit;
          font-size: 12px;
          color: var(--color-accent-primary, #00ff41);
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: 4px 6px;
          cursor: pointer;
          accent-color: var(--color-accent-primary, #00ff41);
        }
        .editor-rail-range { padding: 0; }
        @media (pointer: coarse) {
          .editor-rail-select { min-height: 44px; }
        }
        .editor-sidebar {
          display: none;
          flex-direction: column;
          gap: var(--space-3, 0.75rem);
          padding: 12px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }
        @media (min-width: 900px) {
          .editor-sidebar { display: flex; }
        }
        .editor-sidebar h4 {
          margin: 0;
          padding: 0;
          color: var(--color-accent-primary, #00ff41);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .editor-shortcuts {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }
        .editor-shortcuts kbd {
          display: inline-block;
          min-width: 14px;
          padding: 2px 6px;
          margin-right: 6px;
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        /* At ≥ 900 px the "?" popover becomes redundant — sidebar
           owns the shortcuts. Keep the button for keyboard
           discoverability below the breakpoint. */
        @media (min-width: 900px) {
          .help-wrap { display: none; }
        }
        .canvas-wrap {
          position: relative;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          overflow: hidden;
          background: var(--color-bg-primary, #000);
          min-height: 400px;
          display: flex;
          align-items: center;
          /* touch-action:none unconditionally — iOS Safari treats
             long-press on canvas as context menu and pinch as page
             zoom, both of which break the brush / erase flow even
             when a mouse is also attached (iPad with trackpad). */
          touch-action: none;
          justify-content: center;
        }
        canvas {
          image-rendering: pixelated;
        }
        .editor-footer {
          display: flex;
          justify-content: flex-end;
          padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
        }
        .bg-options {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .bg-options span { font-size: 12px; color: var(--color-text-tertiary, #00b34a); }
        .bg-btn {
          width: 20px; height: 20px;
          border-radius: 0;
          border: 2px solid transparent;
          cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .bg-btn:hover, .bg-btn.active {
          border-color: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 6px rgba(var(--color-accent-rgb, 0, 255, 65), 0.2);
        }
        .bg-checker {
          background-image:
            linear-gradient(45deg, var(--color-preview-checker-dark) 25%, transparent 25%),
            linear-gradient(-45deg, var(--color-preview-checker-dark) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, var(--color-preview-checker-dark) 75%),
            linear-gradient(-45deg, transparent 75%, var(--color-preview-checker-dark) 75%);
          background-size: 6px 6px;
          background-position: 0 0, 0 3px, 3px -3px, 3px 0;
          background-color: var(--color-preview-checker-light);
        }
        .hint {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
          text-align: center;
          padding: var(--space-1, 0.25rem);
        }
        .zoom-display {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
        }

        /* Touch brush indicator (replaces cursor on touch devices) */
        .touch-indicator {
          display: none;
          position: absolute;
          border: 2px solid var(--color-accent-primary, #00ff41);
          pointer-events: none;
          z-index: 15;
          opacity: 0.8;
          box-shadow: 0 0 6px rgba(var(--color-accent-rgb, 0, 255, 65), 0.4);
        }
        .touch-indicator.circle {
          border-radius: 50%;
        }
        .touch-indicator.square {
          border-radius: 0;
        }
        .touch-indicator.visible {
          display: block;
        }

        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .toolbar {
            gap: var(--space-2, 0.5rem);
            padding: var(--space-2, 0.5rem);
          }
          .toolbar label {
            font-size: 12px;
          }
          .toolbar select {
            min-height: 36px;
          }
          .toolbar input[type="range"] {
            width: 80px;
            min-height: 36px;
          }
          .toolbar-btn {
            min-height: 44px;
            min-width: 44px;
            padding: 4px 8px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .separator {
            display: none;
          }
          .canvas-wrap {
            min-height: 300px;
          }
          .editor-footer {
            padding: var(--space-2, 0.5rem);
          }
          .bg-btn {
            width: 28px;
            height: 28px;
          }
          .help-tooltip {
            right: auto;
            left: 0;
            font-size: 12px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .toolbar {
            gap: var(--space-2, 0.5rem);
          }
          .toolbar-btn {
            min-height: 44px;
            min-width: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .canvas-wrap {
            min-height: 350px;
          }
          .bg-btn {
            width: 28px;
            height: 28px;
          }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .toolbar-btn,
          .toolbar select {
            min-height: 44px;
            min-width: 44px;
          }
          .bg-btn {
            width: 32px;
            height: 32px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .toolbar-btn, .bg-btn {
            transition: none !important;
          }
        }
      </style>

      <div class="editor-container">
        <div class="toolbar">
          <button class="toolbar-btn" id="undo-btn" disabled aria-label="${t('editor.undo')}">${t('editor.undo')}</button>
          <button class="toolbar-btn" id="redo-btn" disabled aria-label="${t('editor.redo')}">${t('editor.redo')}</button>

          <div class="zoom-group">
            <button class="toolbar-btn" id="zoom-out" aria-label="Zoom out">&minus;</button>
            <button class="toolbar-btn" id="zoom-in" aria-label="Zoom in">+</button>
            <span class="zoom-display" id="zoom-display">100%</span>
            <button class="toolbar-btn" id="zoom-fit" aria-label="${t('editor.zoomFit')}">${t('editor.zoomFit')}</button>
          </div>

          <div class="help-wrap">
            <button class="toolbar-btn" id="help-btn" aria-label="${t('editor.shortcuts')}">?</button>
            <div class="help-tooltip" id="help-tooltip">
              <strong>${t('editor.shortcuts')}</strong><br>
              <kbd>Click</kbd> ${t('editor.shortcutErase')}<br>
              <kbd>[ ]</kbd> ${t('editor.shortcutEraserSize')}<br>
              <kbd>Scroll</kbd> ${t('editor.shortcutZoom')}<br>
              <kbd>Middle drag</kbd> ${t('editor.shortcutPan')}<br>
              <kbd>0</kbd> ${t('editor.shortcutResetView')}<br>
              <kbd>Ctrl+Z</kbd> ${t('editor.shortcutUndo')}<br>
              <kbd>Ctrl+Shift+Z</kbd> ${t('editor.shortcutRedo')}
            </div>
          </div>
        </div>

        <!-- Mini command bar above the canvas (#76 sub-task C).
             Promotes Apply / Cancel out of the generic toolbar row
             and adds a "$ edit --brush · brush=N · tool=E/R" live
             status line so the user always knows what Apply will do. -->
        <div class="editor-cmd-bar">
          <div class="editor-cmd-left">
            <span class="editor-cmd-prompt">$</span>
            <span class="editor-cmd-action">edit --brush</span>
            <span class="editor-cmd-meta" id="editor-cmd-meta">·&nbsp;brush=${this.brushSize}·&nbsp;tool=E</span>
          </div>
          <div class="editor-cmd-right">
            <button class="editor-cmd-btn" id="cancel-btn">${t('editor.cancel')}</button>
            <button class="editor-cmd-btn editor-cmd-btn-primary" id="done-btn">${t('editor.apply')}</button>
          </div>
        </div>
        <div class="editor-body">
          <!-- Left rail (#76 sub-task A). At ≥ 900 px it stacks
               tool + shape + size vertically next to the canvas.
               Below 900 px it flattens to a horizontal row above
               the canvas, keeping the controls reachable on mobile. -->
          <aside class="editor-rail" aria-label="${t('editor.tool')}">
            <div class="editor-rail-group">
              <label id="ed-tool-label" class="editor-rail-label">${t('editor.tool')}</label>
              <select id="brush-tool" class="editor-rail-select" aria-label="${t('editor.tool')}">
                <option value="erase" selected>${t('editor.eraser')}</option>
                <option value="restore">${t('editor.restore')}</option>
              </select>
            </div>
            <div class="editor-rail-group">
              <label id="ed-brush-label" class="editor-rail-label">${t('editor.shape')}</label>
              <select id="brush-shape" class="editor-rail-select" aria-label="${t('editor.shape')}">
                <option value="circle" selected>${t('editor.eraserCircle')}</option>
                <option value="square">${t('editor.eraserSquare')}</option>
              </select>
            </div>
            <div class="editor-rail-group">
              <label id="ed-size-label" class="editor-rail-label">${t('editor.eraserSize')}</label>
              <input type="range" id="brush-size" class="editor-rail-range" min="2" max="100" value="20" aria-label="${t('editor.eraserSize')}">
              <span class="size-display" id="size-display">20px</span>
            </div>
          </aside>
          <div class="canvas-wrap" id="canvas-wrap">
            <canvas id="editor-canvas" tabindex="0" role="img"
                    aria-label="${t('editor.canvasLabel')}"></canvas>
            <div class="touch-indicator" id="touch-indicator"></div>
          </div>
          <aside class="editor-sidebar" aria-labelledby="ed-shortcuts-title">
            <h4 id="ed-shortcuts-title">${t('editor.shortcuts')}</h4>
            <div class="editor-shortcuts">
              <div><kbd>Click</kbd> ${t('editor.shortcutErase')}</div>
              <div><kbd>[ ]</kbd> ${t('editor.shortcutEraserSize')}</div>
              <div><kbd>Scroll</kbd> ${t('editor.shortcutZoom')}</div>
              <div><kbd>Middle drag</kbd> ${t('editor.shortcutPan')}</div>
              <div><kbd>0</kbd> ${t('editor.shortcutResetView')}</div>
              <div><kbd>Ctrl+Z</kbd> ${t('editor.shortcutUndo')}</div>
              <div><kbd>Ctrl+Shift+Z</kbd> ${t('editor.shortcutRedo')}</div>
            </div>
          </aside>
        </div>

        <div class="editor-footer">
          <div class="bg-options">
            <span id="ed-bg-label">${t('editor.bg')}</span>
            <div class="bg-btn bg-checker active" data-bg="checker" title="${t('bg.checkerboard')}"></div>
            <div class="bg-btn" style="background:var(--color-preview-white)" data-bg="#ffffff" title="${t('bg.white')}"></div>
            <div class="bg-btn" style="background:var(--color-preview-black)" data-bg="#000000" title="${t('bg.black')}"></div>
            <div class="bg-btn" style="background:var(--color-preview-green)" data-bg="#00b140" title="${t('bg.green')}"></div>
            <div class="bg-btn" style="background:var(--color-preview-red)" data-bg="#ff4444" title="${t('bg.red')}"></div>
          </div>
        </div>
      </div>
    `;
  }

  private setupCanvas(): void {
    this.canvas = this.shadowRoot!.querySelector('#editor-canvas')!;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    // Pre-render checker pattern
    this.checkerCanvas = document.createElement('canvas');
    this.checkerCanvas.width = 16;
    this.checkerCanvas.height = 16;
    const cctx = this.checkerCanvas.getContext('2d')!;
    cctx.fillStyle = '#2a2a2e';
    cctx.fillRect(0, 0, 16, 16);
    cctx.fillStyle = '#3a3a3e';
    cctx.fillRect(0, 0, 8, 8);
    cctx.fillRect(8, 8, 8, 8);
  }

  private setupEvents(): void {
    const wrap = this.shadowRoot!.querySelector('#canvas-wrap') as HTMLElement;
    const signal = this.abortController!.signal;

    // Brush shape
    this.shadowRoot!.querySelector('#brush-tool')!.addEventListener('change', (e) => {
      this.tool = (e.target as HTMLSelectElement).value as 'erase' | 'restore';
      this.updateCursor();
      this.syncCmdBarMeta();
    }, { signal });

    this.shadowRoot!.querySelector('#brush-shape')!.addEventListener('change', (e) => {
      this.brushShape = (e.target as HTMLSelectElement).value as BrushShape;
      this.updateCursor();
    }, { signal });

    // Brush size
    const sizeInput = this.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
    const sizeDisplay = this.shadowRoot!.querySelector('#size-display')!;
    sizeInput.addEventListener('input', () => {
      this.brushSize = parseInt(sizeInput.value);
      sizeDisplay.textContent = `${this.brushSize}px`;
      this.updateCursor();
      this.syncCmdBarMeta();
    }, { signal });

    // Undo/Redo
    this.shadowRoot!.querySelector('#undo-btn')!.addEventListener('click', () => this.undo(), { signal });
    this.shadowRoot!.querySelector('#redo-btn')!.addEventListener('click', () => this.redo(), { signal });

    // Zoom
    this.shadowRoot!.querySelector('#zoom-in')!.addEventListener('click', () => this.setZoom(this.zoom * 1.5), { signal });
    this.shadowRoot!.querySelector('#zoom-out')!.addEventListener('click', () => this.setZoom(this.zoom / 1.5), { signal });
    this.shadowRoot!.querySelector('#zoom-fit')!.addEventListener('click', () => this.fitToView(), { signal });

    // Mouse wheel zoom
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.setZoom(this.zoom * factor);
    }, { passive: false, signal });

    // Background buttons
    this.shadowRoot!.querySelectorAll('.bg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shadowRoot!.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editorBg = (btn as HTMLElement).dataset.bg || 'checker';
        this.redraw();
      }, { signal });
    });

    // Help tooltip toggle
    const helpBtn = this.shadowRoot!.querySelector('#help-btn')!;
    const helpTooltip = this.shadowRoot!.querySelector('#help-tooltip')!;
    helpBtn.addEventListener('click', () => helpTooltip.classList.toggle('visible'), { signal });
    // Close on click outside
    this.shadowRoot!.addEventListener('click', (e) => {
      if (e.target !== helpBtn && !helpTooltip.contains(e.target as Node)) {
        helpTooltip.classList.remove('visible');
      }
    }, { signal });
    // Close on Escape — keyboard users otherwise have no way out of
    // the help overlay short of clicking the button again.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpTooltip.classList.contains('visible')) {
        e.preventDefault();
        helpTooltip.classList.remove('visible');
      }
    }, { signal });

    // Canvas mouse events
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e), { signal });
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal });
    this.canvas.addEventListener('mouseup', () => this.onMouseUp(), { signal });
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp(), { signal });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

    // Touch events for canvas
    this.touchIndicator = this.shadowRoot!.querySelector('#touch-indicator');
    wrap.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false, signal });
    wrap.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false, signal });
    wrap.addEventListener('touchend', (e) => this.onTouchEnd(e), { signal });
    wrap.addEventListener('touchcancel', () => this.onTouchEnd(), { signal });

    // Cancel button - discard all edits
    this.shadowRoot!.querySelector('#cancel-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ar:editor-cancel', {
        bubbles: true,
        composed: true,
      }));
    }, { signal });

    // Done button
    this.shadowRoot!.querySelector('#done-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ar:editor-done', {
        bubbles: true,
        composed: true,
        detail: { imageData: this.getResultImageData() },
      }));
    }, { signal });

    // Keyboard shortcuts
    this.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
      }
      if (e.key === '[') { this.brushSize = Math.max(2, this.brushSize - 5); this.updateSizeUI(); this.updateCursor(); }
      if (e.key === ']') { this.brushSize = Math.min(100, this.brushSize + 5); this.updateSizeUI(); this.updateCursor(); }
      if (e.key === '0' || e.key === 'Home') { this.resetView(); }
    }, { signal });
  }

  /** Update the canvas cursor to match brush shape and size */
  private updateCursor(): void {
    if (!this.canvas) return;
    this.canvas.style.cursor = makeBrushCursor(this.brushSize, this.brushShape, this.zoom, this.tool);
  }

  private updateSizeUI(): void {
    const sizeInput = this.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
    const sizeDisplay = this.shadowRoot!.querySelector('#size-display')!;
    sizeInput.value = String(this.brushSize);
    sizeDisplay.textContent = `${this.brushSize}px`;
    this.syncCmdBarMeta();
  }

  /**
   * Keep the editor command bar's live meta line in sync with the
   * current brush size + active tool (#76 sub-task C). Called from
   * every mutation site — tool select, size slider, keyboard [ / ]
   * shortcut — so the header always matches what Apply will do.
   */
  private syncCmdBarMeta(): void {
    const meta = this.shadowRoot?.querySelector('#editor-cmd-meta');
    if (!meta) return;
    const letter = this.tool === 'erase' ? 'E' : 'R';
    meta.innerHTML = `·&nbsp;brush=${this.brushSize}&nbsp;·&nbsp;tool=${letter}`;
  }

  /**
   * Set the image to edit — called after ML processing.
   *
   * @param imageData the current result (with alpha holes / cleanup needed)
   * @param original  the pre-segmentation source, sampled by the Restore tool.
   */
  setImage(imageData: ImageData, original: ImageData): void {
    this.width = imageData.width;
    this.height = imageData.height;
    this.imageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      this.width,
      this.height,
    );
    this.originalImage = new ImageData(
      new Uint8ClampedArray(original.data),
      this.width,
      this.height,
    );

    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();

    this.fitToView();
    this.redraw();
    this.updateCursor();
  }

  private fitToView(): void {
    const wrap = this.shadowRoot!.querySelector('#canvas-wrap') as HTMLElement;
    if (!wrap || !this.width) return;

    const wrapW = wrap.clientWidth || 800;
    const wrapH = wrap.clientHeight || 400;
    const scaleX = wrapW / this.width;
    const scaleY = wrapH / this.height;
    this.zoom = Math.min(scaleX, scaleY, 2) * 0.9;
    this.panX = 0;
    this.panY = 0;
    this.canvas.style.transform = 'translate(0px, 0px)';
    this.updateCanvasSize();
  }

  private setZoom(z: number): void {
    this.zoom = Math.max(0.1, Math.min(10, z));
    this.updateCanvasSize();
    this.updateCursor();
  }

  /** Reset pan and fit to view */
  private resetView(): void {
    this.panX = 0;
    this.panY = 0;
    this.canvas.style.transform = 'translate(0px, 0px)';
    this.fitToView();
    this.updateCursor();
  }

  private updateCanvasSize(): void {
    if (!this.width) return;
    const displayW = Math.round(this.width * this.zoom);
    const displayH = Math.round(this.height * this.zoom);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;

    const zoomDisplay = this.shadowRoot!.querySelector('#zoom-display');
    if (zoomDisplay) zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;

    this.redraw();
  }

  private redraw(): void {
    if (!this.imageData || !this.ctx) return;

    // Draw selected background
    if (this.editorBg === 'checker') {
      const pattern = this.ctx.createPattern(this.checkerCanvas, 'repeat');
      if (pattern) {
        this.ctx.fillStyle = pattern;
        this.ctx.fillRect(0, 0, this.width, this.height);
      }
    } else {
      this.ctx.fillStyle = this.editorBg;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }

    // Draw image with current alpha on top
    // Reuse temp canvas because putImageData ignores compositing
    // Fallback to HTMLCanvasElement if OffscreenCanvas is not available (Safari iOS <16.4)
    if (!this.tempCanvas || this.tempCanvas.width !== this.width || this.tempCanvas.height !== this.height) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.tempCanvas = new OffscreenCanvas(this.width, this.height);
      } else {
        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = this.width;
        this.tempCanvas.height = this.height;
      }
    }
    const tempCtx = this.tempCanvas.getContext('2d')!;
    tempCtx.putImageData(this.imageData, 0, 0);
    this.ctx.drawImage(this.tempCanvas, 0, 0);
  }

  /** Convert mouse event to image pixel coordinates */
  private eventToPixel(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.zoom);
    const y = Math.floor((e.clientY - rect.top) / this.zoom);
    return { x, y };
  }

  private onMouseDown(e: MouseEvent): void {
    e.preventDefault();

    // Middle button = pan
    if (e.button === 1) {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // Left = erase only (right-click disabled)
    if (e.button === 0) {
      this.isErasing = true;
    } else {
      return;
    }

    // Save state for undo before starting stroke
    this.pushUndo();
    this.applyBrush(e);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isPanning) {
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.panX += dx;
      this.panY += dy;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
      return;
    }

    if (this.isErasing) {
      this.applyBrush(e);
    }
  }

  private onMouseUp(): void {
    this.isPanning = false;
    this.isErasing = false;
    this.updateCursor();
  }

  /** Convert touch coordinates to image pixel coordinates */
  private touchToPixel(touch: Touch): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((touch.clientX - rect.left) / this.zoom);
    const y = Math.floor((touch.clientY - rect.top) / this.zoom);
    return { x, y };
  }

  /** Get distance between two touches for pinch detection */
  private getPinchDist(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private onTouchStart(e: TouchEvent): void {
    if (!this.imageData) return;

    if (e.touches.length === 2) {
      // Pinch-to-zoom: two fingers
      e.preventDefault();
      this.isTouchErasing = false;
      this.lastPinchDist = this.getPinchDist(e.touches);
      this.hideTouchIndicator();
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      // Single finger = erase
      this.isTouchErasing = true;
      this.pushUndo();
      this.applyBrushAt(this.touchToPixel(e.touches[0]));
      this.showTouchIndicator(e.touches[0]);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.imageData) return;

    if (e.touches.length === 2) {
      // Pinch-to-zoom
      e.preventDefault();
      const dist = this.getPinchDist(e.touches);
      if (this.lastPinchDist > 0) {
        const scale = dist / this.lastPinchDist;
        this.setZoom(this.zoom * scale);
      }
      this.lastPinchDist = dist;
      this.hideTouchIndicator();
      return;
    }

    if (e.touches.length === 1 && this.isTouchErasing) {
      e.preventDefault();
      this.applyBrushAt(this.touchToPixel(e.touches[0]));
      this.showTouchIndicator(e.touches[0]);
    }
  }

  private onTouchEnd(e?: TouchEvent): void {
    this.isTouchErasing = false;
    this.lastPinchDist = 0;
    this.hideTouchIndicator();
    if (e && e.touches.length === 0) {
      // All fingers released
    }
  }

  private showTouchIndicator(touch: Touch): void {
    if (!this.touchIndicator) return;
    const wrap = this.shadowRoot!.querySelector('#canvas-wrap') as HTMLElement;
    const wrapRect = wrap.getBoundingClientRect();
    const size = Math.max(12, Math.round(this.brushSize * this.zoom));
    const x = touch.clientX - wrapRect.left - size / 2;
    const y = touch.clientY - wrapRect.top - size / 2;
    this.touchIndicator.style.width = `${size}px`;
    this.touchIndicator.style.height = `${size}px`;
    this.touchIndicator.style.left = `${x}px`;
    this.touchIndicator.style.top = `${y}px`;
    this.touchIndicator.className = `touch-indicator visible ${this.brushShape}`;
  }

  private hideTouchIndicator(): void {
    if (!this.touchIndicator) return;
    this.touchIndicator.classList.remove('visible');
  }

  /** Apply brush at pixel coordinates (shared between mouse and touch) */
  private applyBrushAt(pos: { x: number; y: number }): void {
    this.stamp(pos.x, pos.y);
  }

  private applyBrush(e: MouseEvent): void {
    const p = this.eventToPixel(e);
    this.stamp(p.x, p.y);
  }

  /**
   * Paint one brush stamp at (cx,cy).
   *
   * - `erase`: writes alpha=0 to every pixel under the brush.
   * - `restore`: copies RGBA from the pre-segmentation original, which
   *   brings back both color and alpha=original. Useful for interior holes
   *   the ML mask wrongly punched because the subject shared the
   *   background color.
   */
  private stamp(cx: number, cy: number): void {
    if (!this.imageData || !this.originalImage) return;
    const data = this.imageData.data;
    const src = this.originalImage.data;
    const restore = this.tool === 'restore';
    const r = Math.floor(this.brushSize / 2);
    const circle = this.brushShape === 'circle';
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= this.width || py < 0 || py >= this.height) continue;
        if (circle && dx * dx + dy * dy > r2) continue;
        const i = (py * this.width + px) * 4;
        if (restore) {
          data[i] = src[i];
          data[i + 1] = src[i + 1];
          data[i + 2] = src[i + 2];
          data[i + 3] = src[i + 3];
        } else {
          data[i + 3] = 0;
        }
      }
    }
    this.redraw();
  }

  private snapshot(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.imageData!.data);
  }

  private pushUndo(): void {
    if (!this.imageData) return;
    this.undoStack.push({ rgba: this.snapshot() });
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoRedoButtons();
  }

  private undo(): void {
    if (!this.undoStack.length || !this.imageData) return;
    this.redoStack.push({ rgba: this.snapshot() });
    const prev = this.undoStack.pop()!;
    this.imageData.data.set(prev.rgba);
    this.updateUndoRedoButtons();
    this.redraw();
  }

  private redo(): void {
    if (!this.redoStack.length || !this.imageData) return;
    this.undoStack.push({ rgba: this.snapshot() });
    const next = this.redoStack.pop()!;
    this.imageData.data.set(next.rgba);
    this.updateUndoRedoButtons();
    this.redraw();
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = this.shadowRoot!.querySelector('#undo-btn') as HTMLButtonElement;
    const redoBtn = this.shadowRoot!.querySelector('#redo-btn') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  /** Get the edited ImageData */
  getResultImageData(): ImageData {
    return this.imageData!;
  }

  reset(): void {
    this.imageData = null;
    this.originalImage = null;
    this.undoStack = [];
    this.redoStack = [];
  }
}

customElements.define('ar-editor', ArEditor);
