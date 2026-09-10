/**
 * Shadow-DOM HTML template for <ar-editor-advanced>.
 *
 * Extracted from ar-editor-advanced.ts render() as part of the #255 split,
 * mirroring ar-app.template.ts from #254. Returns the full shadow HTML with
 * the styles embedded in a <style> tag, preserving the original injection
 * mechanism (innerHTML on the shadow root, not adoptedStyleSheets).
 *
 * SECURITY — read before adding an interpolation.
 *
 * `no-unsanitized/property` is NOT enforced on this file. It is *suppressed*
 * at the call site, on the innerHTML assignment in ar-editor-advanced.ts. So
 * nothing here is lint-checked and a new `${...}` will not be caught by CI.
 *
 * At the time of extraction this template held 91 interpolations: 85 of the
 * form `t('literal.key')` and 6 project-owned module constants. Zero came
 * from anywhere else, and zero referenced instance state — which is why this
 * is a function of no arguments, and why it should stay one. Arguments would
 * move the audit boundary out to every caller; with none, every value here is
 * verifiable by reading this file alone.
 *
 * Keep every interpolation either `t(...)` (the trusted i18n helper, called
 * with a literal key) or a static project-owned constant. Never a filename, a
 * fetched response, an image name, or anything else a user can influence —
 * that is an XSS, and the linter will not stop you.
 */
import { t } from '../i18n';
import { AR_EDITOR_ADVANCED_STYLES } from './ar-editor-advanced.styles';
import { DEFAULT_BRUSH, MIN_BRUSH, MAX_BRUSH } from './ar-editor-advanced.constants';

export function renderArEditorAdvancedTemplate(): string {
  return `
      <style>
        ${AR_EDITOR_ADVANCED_STYLES}
      </style>
      <!-- Command bar (#346). Live status on the left, session-level
           verbs on the right. Zoom, undo/redo, cancel and apply were
           scattered between the old .toolbar and .controls rows. -->
      <div class="editor-cmd-bar">
        <div class="editor-cmd-left">
          <span class="editor-cmd-prompt">$</span>
          <span class="editor-cmd-action" id="adv-cmd-action">edit --eraser</span>
          <span class="editor-cmd-meta" id="adv-cmd-meta">&middot; size=${DEFAULT_BRUSH}</span>
        </div>
        <div class="editor-cmd-right">
          <div class="zoom-group" role="group" aria-label="${t('advanced.zoom')}">
            <button type="button" class="zoom-btn" id="zoom-out" title="${t('advanced.zoomOut')}" aria-label="${t('advanced.zoomOut')}">−</button>
            <span class="zoom-display" id="zoom-display">100%</span>
            <button type="button" class="zoom-btn" id="zoom-in" title="${t('advanced.zoomIn')}" aria-label="${t('advanced.zoomIn')}">+</button>
            <button type="button" class="zoom-btn" id="zoom-fit" title="${t('advanced.zoomFit')}" aria-label="${t('advanced.zoomFit')}">⌂</button>
          </div>
          <button type="button" class="action secondary" id="undo" disabled>${t('advanced.undo')}</button>
          <button type="button" class="action secondary" id="redo" disabled>${t('advanced.redo')}</button>
          <button type="button" class="action secondary" id="cancel">${t('advanced.cancel')}</button>
          <button type="button" class="action" id="done">${t('advanced.apply')}</button>
        </div>
      </div>
      <div class="editor-body">
        <!-- Left rail. The size slider stays mounted regardless of tool
             so switching to lasso causes no layout shift (#77). -->
        <aside class="editor-rail" aria-label="${t('advanced.helpTools')}">
          <div class="editor-rail-group">
            <span class="editor-rail-label">${t('advanced.helpTools')}</span>
            <div class="tool-group" role="group" aria-label="Tools">
              <button type="button" class="tool-btn" id="tool-brush">${t('advanced.toolBrush')}</button>
              <button type="button" class="tool-btn active" id="tool-eraser">${t('advanced.toolEraser')}</button>
              <button type="button" class="tool-btn" id="tool-lasso">${t('advanced.toolLasso')}</button>
            </div>
          </div>
          <div class="editor-rail-group" id="shape-row">
            <span class="editor-rail-label">${t('editor.shape')}</span>
            <div class="tool-group" role="group" aria-label="${t('editor.shape')}">
              <button type="button" class="tool-btn active" id="shape-circle">${t('editor.eraserCircle')}</button>
              <button type="button" class="tool-btn" id="shape-square">${t('editor.eraserSquare')}</button>
            </div>
          </div>
          <div class="editor-rail-group size-row" id="size-row">
            <label class="editor-rail-label" for="brush-size">${t('advanced.size')}</label>
            <input type="range" id="brush-size" min="${MIN_BRUSH}" max="${MAX_BRUSH}" step="1" value="${DEFAULT_BRUSH}">
            <span class="size-val" id="brush-size-val">${DEFAULT_BRUSH}</span>
          </div>
          <div class="editor-rail-group">
            <span class="editor-rail-label">${t('viewer.bg')}</span>
            <div class="bg-options" role="group" aria-label="${t('viewer.bg')}">
              <div class="bg-btn bg-checker active" data-bg="transparent" title="${t('bg.transparent')}"></div>
              <div class="bg-btn bg-white" data-bg="white" title="${t('bg.white')}"></div>
              <div class="bg-btn bg-black" data-bg="black" title="${t('bg.black')}"></div>
              <div class="bg-btn" style="background:var(--color-preview-green)" data-bg="#00b140" title="${t('bg.green')}"></div>
              <div class="bg-btn bg-red" data-bg="#ff4444" title="${t('bg.red')}"></div>
            </div>
          </div>
        </aside>

        <div class="editor-canvas-col">
          <div class="canvas-wrap"><canvas tabindex="0" role="img"
            aria-label="${t('advanced.canvasLabel')}"></canvas></div>
          <!-- Contextual strip: lasso group or preview-confirm group.
               Collapses when neither is .visible. -->
          <div class="editor-context">
            <div class="lasso-actions" id="lasso-actions" role="group" aria-label="Lasso actions">
              <button type="button" class="action-btn lead" id="action-refine" title="${t('advanced.actionRefineHint')}">${t('advanced.actionRefine')}</button>
              <button type="button" class="action-btn" id="action-crop" title="${t('advanced.actionCropHint')}">${t('advanced.actionCrop')}</button>
              <button type="button" class="action-btn" id="action-remove-watermark" title="${t('advanced.actionRemoveWatermarkHint')}">${t('advanced.actionRemoveWatermark')}</button>
              <span class="action-sep" aria-hidden="true"></span>
              <button type="button" class="action-btn danger" id="action-erase-object" title="${t('advanced.actionEraseObjectHint')}">${t('advanced.actionEraseObject')}</button>
              <span class="busy-indicator hidden" id="busy">${t('advanced.working')}</span>
              <button type="button" class="action-btn cancel-action hidden" id="cancel-action">${t('advanced.cancelAction')}</button>
            </div>
            <div class="preview-actions" id="preview-actions" role="group" aria-label="Confirm preview">
              <span class="preview-diff" id="preview-diff" aria-live="polite"></span>
              <button type="button" class="key-btn confirm" id="action-apply-preview" title="${t('advanced.previewApplyHint')}"><kbd aria-hidden="true">&crarr;</kbd>${t('advanced.previewApply')}</button>
              <button type="button" class="key-btn danger" id="action-cancel-preview" title="${t('advanced.previewCancelHint')}"><kbd aria-hidden="true">esc</kbd>${t('advanced.previewCancel')}</button>
            </div>
          </div>
        </div>

        <aside class="editor-sidebar">
          <div class="editor-rail-group">
            <h4>${t('advanced.title')}</h4>
            <button type="button" class="restore-btn" id="restore-original" title="${t('advanced.restoreHint')}">${t('advanced.restore')}</button>
            <button type="button" class="restore-btn" id="reprocess" title="${t('advanced.reprocessHint')}">${t('advanced.reprocess')}</button>
          </div>
          <div class="editor-rail-group">
            <button type="button" class="help-btn" id="help-toggle" title="${t('advanced.help')}" aria-label="${t('advanced.help')}" aria-expanded="false">?</button>
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
        </aside>
      </div>
      <div class="controls">
        <span class="hint" id="hint">${t('advanced.hint')}</span>
      </div>
`;
}
