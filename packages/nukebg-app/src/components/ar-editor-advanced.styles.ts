/**
 * Shadow-DOM styles for <ar-editor-advanced>.
 *
 * Lifted verbatim from the <style> block in ar-editor-advanced.ts render()
 * as part of the split in #255. This constant is interpolated back inside
 * the <style> tag by that same render(), so the injection mechanism is
 * unchanged (a <style> element in the shadow root, not adoptedStyleSheets)
 * and the rendered CSS is byte-identical to before the move.
 *
 * Mirrors ar-app.styles.ts, extracted the same way in #254.
 *
 * Do NOT add dynamic expressions here. The string is static and must stay
 * that way: render() suppresses `no-unsanitized/property` at its innerHTML
 * assignment, so nothing interpolated into that template is lint-checked,
 * and a `${...}` added here would ride into the DOM unexamined.
 *
 * Two source-level suites read this file as text rather than the component:
 * css-token-integrity.test.ts picks it up by globbing src/components, and
 * ar-advanced-toolbar.test.ts concatenates it with the component. Renaming
 * or moving this file needs both of them checked.
 */
export const AR_EDITOR_ADVANCED_STYLES: string = `
        :host {
          display: none;
          margin-top: 12px;
          padding: 12px;
          border: 1px dashed var(--color-accent-primary, #00ff41);
          border-radius: 0;
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.04);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }
        :host([active]) { display: block; }
        @media (pointer: coarse) {
          :host([active]) { padding-bottom: 140px; }
        }
        .restore-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: background 0.15s, color 0.15s;
        }
        .restore-btn:hover:not(:disabled) {
          background: var(--color-accent-primary, #00ff41);
          color: #000;
        }
        .restore-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .help-btn {
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          width: 22px;
          height: 22px;
          padding: 0;
          cursor: pointer;
          line-height: 1;
          transition: background 0.15s, color 0.15s;
        }
        .help-btn:hover,
        .help-btn[aria-expanded="true"] {
          background: var(--color-accent-primary, #00ff41);
          color: #000;
        }
        /* The panel lives inside .editor-sidebar (a 260px track with
           12px padding) since #350, so auto-fit at a 220px minimum no
           longer fits and the nowrap shortcut rows pushed out of the
           column. Scope the overrides so the pre-#350 rules still apply
           anywhere else the panel is used. */
        .editor-sidebar .help-panel {
          grid-template-columns: minmax(0, 1fr);
          max-width: 100%;
        }
        .editor-sidebar .help-section dl {
          grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
        }
        .editor-sidebar .help-section dt {
          white-space: normal;
        }
        .help-panel {
          margin-bottom: 8px;
          padding: 10px 12px;
          border: 1px solid rgba(var(--color-accent-rgb, 0, 255, 65), 0.35);
          border-radius: 0;
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.03);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
        }
        .help-panel.hidden { display: none; }
        .help-section h4 {
          margin: 0 0 6px 0;
          font-size: 10px;
          color: var(--color-accent-primary, #00ff41);
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
          color: var(--color-text-secondary, #00dd44);
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
          border: 1px solid rgba(var(--color-accent-rgb, 0, 255, 65), 0.45);
          border-bottom-width: 2px;
          border-radius: 0;
          background: rgba(0, 0, 0, 0.35);
          color: var(--color-text-secondary, #00dd44);
          font-family: inherit;
          font-size: 10px;
          line-height: 1;
        }
        .help-note {
          margin: 8px 0 0 0;
          padding: 6px 8px;
          border-left: 2px solid var(--color-accent-primary, #00ff41);
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.05);
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
        /* Editor shell (#346). Replaces the two-row .toolbar from #77
           with the regions ar-editor.ts already defines: a command bar
           on top, then a rail | canvas | sidebar grid behind the 900 px
           breakpoint. Same class names on purpose — both editors now
           share one layout grammar instead of two.

           One deliberate divergence from ar-editor.ts: that sidebar is
           display:none below 900 px because it only duplicates the "?"
           tooltip. This one carries restore / reprocess / help, so it
           stays visible at every width and stacks under the canvas. */
        .editor-cmd-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          margin-bottom: 10px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
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
          flex-wrap: wrap;
        }
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
        /* Coarse pointer docks the rail with position: fixed (see the
           pointer: coarse block below), which takes it out of flow but
           NOT out of the grid. Without this the 200px track survives as
           an empty gutter on iPad landscape — 1024px wide and coarse. */
        @media (min-width: 900px) and (pointer: coarse) {
          .editor-body {
            grid-template-columns: minmax(0, 1fr) 260px;
          }
        }
        .editor-rail {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
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
        .editor-canvas-col {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .editor-sidebar {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 0.75rem);
          padding: 12px;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: var(--color-bg-primary, #000);
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }
        .editor-sidebar h4 {
          margin: 0;
          color: var(--color-accent-primary, #00ff41);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        /* Contextual strip directly under the canvas. Carries the lasso
           group and the preview-confirm group, and collapses entirely
           when neither child is .visible so it never leaves a dead
           border — the behaviour .toolbar-row-contextual had. */
        .editor-context {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--color-surface-border, #1a3a1a);
        }
        .editor-context:not(:has(> .visible)) {
          display: none;
        }
        .tool-group {
          display: flex;
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          overflow: hidden;
        }
        /* Buttons share the rail width evenly — a 200 px column cannot
           hold three inline-flex tool buttons without overflowing. */
        .tool-group .tool-btn { flex: 1 1 0; min-width: 0; }
        .tool-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: none;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .tool-btn + .tool-btn { border-left: 1px solid var(--color-accent-primary, #00ff41); }
        .tool-btn.active {
          background: var(--color-accent-primary, #00ff41);
          color: #000;
        }
        /* Label on its own line, slider and read-out sharing the next —
           works in both rail orientations (column at ≥ 900 px, wrapped
           row below) without needing a wrapper element. */
        .size-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            'label label'
            'range value';
          align-items: center;
          gap: 4px 8px;
        }
        .size-row.disabled,
        #shape-row.disabled {
          opacity: 0.4;
          pointer-events: none;
        }
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
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: background 0.15s, color 0.15s;
        }
        .action-btn:hover:not(:disabled) { background: var(--color-accent-primary, #00ff41); color: #000; }
        .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        /* Four identical buttons made every lasso action look equally
           safe. Refine leads because it is the common one; erase-object
           is fenced off behind a rule because it is the destructive one. */
        .action-btn.lead {
          border-color: var(--color-accent-primary, #00ff41);
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.06);
        }
        .action-sep {
          width: 1px;
          align-self: stretch;
          min-height: 20px;
          background: var(--color-surface-border, #1a3a1a);
          margin: 0 2px;
        }
        .action-btn.danger {
          color: var(--color-error, #ff3131);
          border-color: var(--color-error, #ff3131);
        }
        .action-btn.danger:hover:not(:disabled) { background: var(--color-error, #ff3131); color: #000; }
        .action-btn.confirm {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
        }
        .action-btn.confirm:hover:not(:disabled) { background: var(--color-accent-primary, #00ff41); color: #000; }
        .preview-diff {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--color-text-tertiary, #00b34a);
          margin-right: 6px;
          white-space: nowrap;
        }
        /* Preview confirm pair (#346). The failure mode was two buttons
           that LOOK alike, not two words that read alike — so these are
           keycaps, separated from the session buttons by shape before
           anything is read. Enter and Escape drive the same two paths.
           The kbd recipe is the one already in .help-section kbd and
           main.css .kbd-overlay-list kbd, so no new vocabulary. */
        .key-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 30px;
          padding: 0 10px 0 6px;
          background: transparent;
          border: 1px dashed var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          color: var(--color-text-secondary, #00dd44);
          font-family: inherit;
          font-size: 11px;
          letter-spacing: 0.04em;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 0.15s ease, color 0.15s ease;
        }
        .key-btn kbd {
          display: inline-block;
          padding: 1px 6px;
          border: 1px solid currentColor;
          border-bottom-width: 2px;
          border-radius: 0;
          background: rgba(0, 0, 0, 0.35);
          color: inherit;
          font-family: inherit;
          font-size: 10px;
          line-height: 1.3;
          opacity: 0.9;
        }
        .key-btn.confirm {
          border-color: rgba(var(--color-accent-rgb, 0, 255, 65), 0.5);
          color: var(--color-accent-primary, #00ff41);
        }
        .key-btn.danger {
          border-color: rgba(255, 49, 49, 0.45);
          color: var(--color-error, #ff3131);
        }
        .key-btn:hover:not(:disabled),
        .key-btn:focus-visible {
          border-style: solid;
          outline: none;
        }
        .key-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        /* On touch there is no Enter or Escape, so these must stay real
           44px targets — a keyboard-only answer would be worse than the
           plain-word buttons it replaces. */
        @media (pointer: coarse) {
          .key-btn {
            min-height: 44px;
            flex: 1 1 auto;
            justify-content: center;
          }
        }
        .preview-actions {
          display: none;
          gap: 6px;
          align-items: center;
        }
        .preview-actions.visible { display: inline-flex; }
        .busy-indicator {
          font-size: 10px;
          color: var(--color-accent-primary, #00ff41);
          margin-left: 6px;
        }
        .busy-indicator.hidden { display: none; }
        .cancel-action { margin-left: 2px; }
        .cancel-action.hidden { display: none; }
        .size-row label { grid-area: label; }
        .size-row input[type="range"] {
          grid-area: range;
          accent-color: var(--color-accent-primary, #00ff41);
          width: 100%;
          min-width: 0;
        }
        .size-row .size-val {
          grid-area: value;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: var(--color-text-secondary, #00dd44);
          min-width: 28px;
          text-align: right;
        }
        .bg-options {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          padding: 2px 0;
        }
        .bg-btn {
          width: 18px; height: 18px;
          border-radius: 0;
          border: 2px solid transparent;
          cursor: pointer;
          transition: border-color 0.15s;
          flex-shrink: 0;
        }
        .bg-btn:hover, .bg-btn.active {
          border-color: var(--color-accent-primary, #00ff41);
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
        .bg-white { background: var(--color-preview-white); }
        .bg-black { background: var(--color-preview-black); }
        .bg-red { background: var(--color-preview-red); }
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
        canvas.disabled { cursor: not-allowed; pointer-events: none; }
        canvas.panning { cursor: grabbing; }
        /* Keyboard focus ring (#186). Canvas is focusable via
           tabindex="0"; without an explicit rule, shadow-DOM scope
           hides the document-level :focus-visible style. */
        canvas:focus-visible {
          outline: 2px solid var(--color-accent-primary, #00ff41);
          outline-offset: 2px;
        }
        .zoom-group {
          display: inline-flex;
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          overflow: hidden;
          margin-left: auto;
        }
        .zoom-btn {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: none;
          padding: 4px 10px;
          cursor: pointer;
          letter-spacing: 0.05em;
          min-width: 28px;
          text-align: center;
        }
        .zoom-btn + .zoom-btn { border-left: 1px solid var(--color-accent-primary, #00ff41); }
        .zoom-btn:hover:not(:disabled) { background: var(--color-accent-primary, #00ff41); color: #000; }
        .zoom-display {
          font-family: inherit;
          font-size: 11px;
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: none;
          padding: 4px 8px;
          min-width: 44px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          pointer-events: none;
        }
        /* Footer strip. Undo / redo / cancel / apply moved up into the
           command bar (#346), so this now carries only the live hint. */
        .controls {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          justify-content: flex-start;
          flex-wrap: wrap;
        }
        .hint {
          flex: 1;
          font-size: 10px;
          color: var(--color-text-tertiary, #888);
          align-self: center;
          transition: color 0.2s;
        }
        .hint.busy {
          color: var(--color-accent-primary, #00ff41);
          animation: hint-pulse 1.2s ease-in-out infinite;
        }
        @keyframes hint-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        button.action {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg-elevated, #111111);
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid var(--color-accent-primary, #00ff41);
          border-radius: 0;
          padding: 5px 12px;
          cursor: pointer;
        }
        button.action:hover:not(:disabled) { background: var(--color-accent-primary, #00ff41); color: #000; }
        button.action:disabled { opacity: 0.4; cursor: not-allowed; }
        button.action.secondary { color: var(--color-text-secondary, #999); border-color: var(--color-surface-border, #1a3a1a); }

        /* #35 — honor prefers-reduced-motion on any JS/CSS anim that
           ar-editor-advanced owns. Keeps hint-pulse from firing for
           users who opted out of motion effects. */
        @media (prefers-reduced-motion: reduce) {
          .hint { animation: none !important; }
        }

        @media (pointer: coarse) {
          /* Reserve space for the fixed bottom dock so the rest of the
             editor can scroll into view above it instead of being eaten
             by the fixed bar. */
          :host {
            padding-bottom: calc(160px + env(safe-area-inset-bottom, 0px));
          }
          /* The rail becomes the dock on touch. It carries the controls
             that belong under a thumb — tool, size, background — which
             is what the old fixed .toolbar held. The contextual lasso
             and preview groups now sit in flow directly under the
             canvas instead, next to the pixels they act on. Mobile gets
             a fuller pass in #154. */
          .editor-rail {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 100;
            margin: 0;
            padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)) 10px;
            background: rgba(17, 17, 17, 0.95);
            border: none;
            border-top: 1px solid rgba(var(--color-accent-rgb, 0, 255, 65), 0.3);
            border-radius: 0;
            flex-direction: column;
            flex-wrap: nowrap;
            align-items: stretch;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            gap: 6px;
          }
          .tool-group {
            display: flex;
            width: 100%;
          }
          .tool-btn {
            flex: 1;
            font-size: 12px;
            padding: 8px 6px;
            min-height: 44px;
            text-align: center;
          }
          .size-row { width: 100%; }
          .lasso-actions.visible {
            display: flex;
            flex-wrap: wrap;
            width: 100%;
            justify-content: center;
          }
          .action-btn {
            font-size: 11px;
            padding: 8px 10px;
            min-height: 44px;
            flex: 1 1 auto;
            text-align: center;
          }
          .preview-actions.visible {
            display: flex;
            width: 100%;
            justify-content: center;
          }
          .zoom-group { display: none; }
          .canvas-wrap { max-height: calc(100vh - 200px); }

          /* #154 — the rest of the 44px floor.
             .tool-btn, .action-btn and .key-btn got it in #350; every
             other control in the editor was left below it. Measured at
             393x852 before this block: undo/redo/cancel/apply 28px tall,
             the five background swatches 22x22, restore/reprocess 24px,
             and the size slider 16px. All of them are things a thumb has
             to hit, and four of the five swatches sit in the dock.
             Desktop is untouched — this is inside pointer: coarse. */
          button.action {
            min-height: 44px;
            padding: 8px 14px;
          }
          .restore-btn {
            min-height: 44px;
            padding: 8px 12px;
          }
          .help-btn {
            width: 44px;
            height: 44px;
          }
          .bg-btn {
            width: 44px;
            height: 44px;
          }
          .bg-options {
            gap: 8px;
            flex-wrap: wrap;
          }
          /* A range input cannot be grown by min-height alone — the track
             stays where it is and only the box around it moves. Give the
             control the height, then size the thumb so the hit area is
             the thumb rather than a 16px sliver of track. */
          .size-row input[type="range"] {
            min-height: 44px;
          }
          .size-row input[type="range"]::-webkit-slider-thumb {
            width: 28px;
            height: 28px;
          }
          .size-row input[type="range"]::-moz-range-thumb {
            width: 28px;
            height: 28px;
            border: none;
          }
        }
`;
