/**
 * Shadow-DOM styles for <ar-app>.
 *
 * Lifted verbatim from the <style> block in ar-app.ts render() as part of
 * the refactor in #254. This constant is embedded inside the <style> tag by
 * ar-app.template.ts so the injection mechanism remains identical to the
 * original (a <style> element inside the shadow root, not adoptedStyleSheets).
 *
 * Do NOT add dynamic expressions here — the string is static and must stay
 * that way so it can be inlined without an eslint-disable comment at the
 * call site.
 */
export const AR_APP_STYLES: string = `
        :host {
          display: block;
          width: 100%;
        }
        .hero {
          text-align: left;
          padding: var(--space-6, 1.5rem) var(--space-6, 1.5rem);
          position: relative;
          overflow: hidden;
        }
        .hero.hidden {
          display: none;
        }
        /* Always-visible panel that carries the [STATUS] line, the
           limitations <details>, the honesty disclaimer and the Ko-fi
           pitch. Sits below the workspace so it follows the current
           image (dropzone, processing, result) on screen. Hidden only
           while the advanced editor is open — see .editor-open below. */
        .status-panel {
          padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem) var(--space-4, 1rem);
        }
        .status-panel.editor-open {
          display: none;
        }
        h1 {
          font-size: var(--text-2xl, 1.5rem);
          font-weight: var(--font-bold, 700);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0 0 0.75rem 0;
          line-height: var(--leading-tight, 1.25);
          font-family: 'JetBrains Mono', monospace;
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.4);
        }
        h1::before {
          content: '$ ';
          color: var(--color-text-tertiary, #00b34a);
        }
        h1 .accent {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 12px rgba(var(--color-accent-rgb, 0, 255, 65), 0.5);
        }
        .subline {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-sm, 0.875rem);
          color: var(--color-text-secondary, #00dd44);
          max-width: none;
          margin: 0 0 var(--space-4, 1rem);
          text-align: left;
          line-height: var(--leading-relaxed, 1.625);
        }
        .subline-long::before {
          content: '# ';
          color: var(--color-text-tertiary, #00b34a);
        }
        /* Hero copy swap per design #73: show the short form at ≤480 px
           so the dropzone gets more vertical room on phones. */
        .hero-title-short, .subline-short { display: none; }
        @media (max-width: 480px) {
          .hero-title-long, .subline-long { display: none; }
          .hero-title-short, .subline-short { display: inline; }
        }
        .model-status {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
          margin-top: var(--space-2, 0.5rem);
          min-height: 1.2em;
        }
        .model-status::before {
          content: '[STATUS] ';
        }
        .model-status.ready {
          color: var(--color-success, #00ff41);
        }
        .install-btn {
          display: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
          background: transparent;
          border: none;
          border-radius: 0;
          padding: var(--space-1, 0.25rem) 0;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transition: color 0.2s ease;
        }
        .install-btn:hover {
          color: var(--color-accent-primary, #00ff41);
        }
        .install-btn.visible {
          display: block;
          margin: var(--space-2, 0.5rem) auto 0;
          text-align: center;
        }
        /* Only show install on mobile/touch devices, never on desktop */
        @media (hover: hover) and (pointer: fine) {
          .install-btn.visible {
            display: none !important;
          }
        }
        .install-guide {
          display: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
          background: rgba(0, 0, 0, 0.95);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: var(--space-4, 1rem);
          margin: var(--space-2, 0.5rem) auto 0;
          max-width: 320px;
          text-align: left;
          line-height: 1.8;
        }
        .install-guide.visible {
          display: block;
        }
        .guide-motivation {
          color: var(--color-accent-primary, #00ff41);
          font-weight: 700;
          text-align: center;
          margin-bottom: var(--space-3, 0.75rem);
          letter-spacing: 0.03em;
        }
        .install-guide-close {
          display: block;
          margin: var(--space-3, 0.75rem) auto 0;
          background: transparent;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          color: var(--color-text-tertiary, #00b34a);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          cursor: pointer;
          padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transition: color 0.2s ease, border-color 0.2s ease;
        }
        .install-guide-close:hover {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
        }
        .workspace {
          display: none;
          padding: var(--space-4, 1rem);
        }
        .workspace.visible {
          display: block;
        }
        .batch-detail-bar,
        .batch-failed-bar {
          max-width: 1200px;
          margin: 0 auto 12px auto;
          display: flex;
          gap: 10px;
          justify-content: flex-start;
          flex-wrap: wrap;
        }
        .back-to-grid-btn,
        .batch-retry-btn,
        .batch-discard-btn {
          background: transparent;
          border: 1px solid var(--color-accent-primary, #00ff41);
          color: var(--color-accent-primary, #00ff41);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          padding: 8px 16px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-radius: 0;
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        .back-to-grid-btn:hover,
        .batch-retry-btn:hover,
        .batch-discard-btn:hover {
          background: rgba(var(--color-accent-rgb, 0, 255, 65), 0.08);
          box-shadow: 0 0 8px rgba(var(--color-accent-rgb, 0, 255, 65), 0.3);
        }
        .batch-discard-btn {
          border-color: var(--color-error-border);
          color: var(--color-error);
        }
        .batch-discard-btn:hover {
          background: rgba(255, 49, 49, 0.08);
          box-shadow: 0 0 8px rgba(255, 49, 49, 0.3);
        }
        .workspace-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-4, 1rem);
        }
        .single-file-workspace {
          display: flex;
          flex-direction: column;
          gap: var(--space-4, 1rem);
        }
        /* Result-view two-column grid (#75). At ≥ 900 px the viewer
           gets the main area and the action column (download + edit
           + advanced) sits to the right. Below 900 px the action
           column collapses under the viewer. Keeps progress attached
           to the viewer column so stage timings stay near the image
           on desktop. */
        .ws-result-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-4, 1rem);
          align-items: start;
        }
        .ws-viewer-col {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 0.5rem);
          min-width: 0;
        }
        .ws-action-col {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 0.75rem);
          min-width: 0;
        }
        @media (min-width: 900px) {
          .ws-result-grid {
            grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
          }
          .ws-action-col {
            position: sticky;
            top: var(--space-4, 1rem);
            align-self: start;
          }
        }
        .features {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0;
          padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
          max-width: 1200px;
          margin: 0 auto;
        }
        .features-disclaimer {
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #00b34a);
          margin-top: var(--space-4, 1rem);
          padding: 0 var(--space-4, 1rem);
          cursor: pointer;
        }
        .features-disclaimer:hover {
          color: var(--color-text-secondary, #00dd44);
        }
        .features-disclaimer a {
          color: var(--color-accent-primary, #00ff41);
          text-decoration: none;
        }
        .features-disclaimer a:hover {
          text-decoration: underline;
        }
        .features-disclaimer s {
          color: var(--color-text-tertiary, #00b34a);
          text-decoration: line-through;
          opacity: 0.7;
        }
        .limitations-detail {
          display: none;
          text-align: left;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--color-text-tertiary, #00b34a);
          margin-top: var(--space-2, 0.5rem);
          padding: var(--space-3, 0.75rem);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          line-height: 1.6;
        }
        .limitations-detail.visible {
          display: block;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border-width: 0;
        }
        .dropzone-disabled {
          opacity: 0.4;
          pointer-events: none;
        }
        /* Full-bleed marquee for the landing — sibling to <section class=hero>.
           Gradient mask fades text at both edges so it never clips mid-word. */
        .marquee-bleed {
          display: block;
          width: 100%;
          overflow: hidden;
          white-space: nowrap;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 6px 0;
          min-height: 28px;
          color: var(--color-text-tertiary, #00b34a);
          border-bottom: 1px solid var(--color-surface-border, #1a3a1a);
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent);
                  mask-image: linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent);
        }
        .marquee-bleed > span {
          display: inline-flex;
          gap: 0;
          animation: marquee-scroll 32s linear infinite;
          will-change: transform;
        }
        /* Two identical halves animate from 0 to -50%; when the first
           half scrolls off the left, the second half sits exactly where
           the first started — seamless, single continuous message
           (no doubled overlap on wide viewports). */
        .marquee-bleed > span > span.marquee-half {
          flex: 0 0 auto;
          padding-right: 3em;
        }
        /* Consolidated [STATUS] line */
        .status-line {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #00b34a);
          margin: 12px 0 0;
          padding: 0;
        }
        .status-line .status-tag {
          color: var(--color-text-tertiary, #00b34a);
        }
        .status-line .status-dot {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 4px var(--color-accent-glow, rgba(0, 255, 65, 0.35));
        }
        /* While the reactor is still warming up, dim the dot + word so
           the [STATUS] line tells the truth — green only after preload
           resolves. */
        .status-reactor[data-state="offline"] {
          color: var(--color-text-tertiary, #00b34a);
        }
        .status-reactor[data-state="offline"] ~ .status-sep,
        .status-line:has(.status-reactor[data-state="offline"]) .status-dot {
          opacity: 0.55;
        }
        .status-line .status-reactor {
          color: var(--color-accent-primary, #00ff41);
        }
        /* Honesty + Ko-fi pitch under the status line. Same monospace
           voice, same tertiary tone as the limitations summary so they
           don't fight the dropzone for attention. */
        /* #354 — these two used to share one rule with the status line
           and the limitations body: four separate messages at 12px
           tertiary, indistinguishable at a glance.
           The ramp is by role, not by decoration. The disclaimer is the
           only actionable one — it tells you what to do when a result is
           wrong — so it reads as body. The Ko-fi pitch is the least
           urgent, stays at tertiary, and gains space so it registers as a
           different kind of message rather than a fourth line of the
           same paragraph. Both use existing tokens; no contrast is
           lowered, and the disclaimer's goes up. */
        .hero-disclaimer {
          margin: 10px 0 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.55;
          color: var(--color-text-secondary, #00dd44);
        }
        .hero-support {
          margin: 14px 0 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.55;
          color: var(--color-text-tertiary, #00b34a);
        }
        .hero-disclaimer s {
          color: var(--color-text-tertiary, #00b34a);
          opacity: 0.7;
        }
        .hero-disclaimer a,
        .hero-support a {
          color: var(--color-accent-primary, #00ff41);
          text-decoration: none;
        }
        .hero-disclaimer a:hover,
        .hero-support a:hover {
          text-decoration: underline;
        }
        .status-line .status-model {
          color: var(--color-text-secondary, #00dd44);
        }
        .status-line .status-sep {
          color: var(--color-surface-border, #1a3a1a);
        }
        .status-details {
          display: inline;
        }
        .status-details summary {
          list-style: none;
          cursor: pointer;
          color: var(--color-text-tertiary, #00b34a);
          text-decoration: underline;
          text-decoration-style: dotted;
          display: inline;
          padding: 2px 0;
          min-height: 24px;
        }
        .status-details summary::-webkit-details-marker { display: none; }
        .status-details summary:hover,
        .status-details summary:focus-visible {
          color: var(--color-text-secondary, #00dd44);
          outline: none;
        }
        .status-details[open] summary {
          color: var(--color-text-secondary, #00dd44);
        }
        .status-limits-body {
          display: block;
          margin-top: 6px;
          color: var(--color-text-tertiary, #00b34a);
          font-size: 12px;
          line-height: 1.55;
          border-left: 1px solid var(--color-surface-border, #1a3a1a);
          padding-left: 10px;
        }
        .status-limits-body a {
          color: var(--color-accent-primary, #00ff41);
        }
        @media (pointer: coarse) {
          .status-details summary { min-height: 44px; padding: 10px 0; }
        }
        @keyframes marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-bleed > span { animation: none; }
        }

        /* Smoke is rendered outside shadow DOM - see main thread */
        @keyframes smoke-rise {
          0% {
            opacity: 0;
            transform: translateY(100px);
          }
          20% {
            opacity: 1;
            transform: translateY(0);
          }
          70% {
            opacity: 0.8;
            transform: translateY(-30px);
          }
          100% {
            opacity: 0;
            transform: translateY(-80px);
          }
        }
        .ws-controls {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: var(--space-4, 1rem);
          padding: var(--space-2, 0.5rem) 0;
        }
        .ws-slider-fixed {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.5rem);
          justify-self: end;
        }
        .ws-action-fixed {
          justify-self: center;
        }
        .ws-precision {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2, 0.5rem);
          padding: var(--space-2, 0.5rem) 0;
        }
        .edit-btn {
          width: 100%;
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          padding: var(--space-3, 0.75rem);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
        }
        /* Prompt that sits above the Editor button and tells the user
           why they might want it. Lives in the action column rather
           than as part of the button label so the button itself stays
           tight and the prompt can wrap on narrow viewports. */
        .advanced-prompt {
          margin: 0 0 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.4;
          color: var(--color-text-tertiary, #00b34a);
        }
        .advanced-cta {
          width: 100%;
          background: transparent;
          color: var(--color-accent-primary, #00ff41);
          border: 1px dashed var(--color-accent-primary, #00ff41);
          border-radius: 0;
          padding: var(--space-3, 0.75rem);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
        }
        .advanced-cta:hover {
          background: var(--color-accent-primary, #00ff41);
          color: var(--color-text-inverse);
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.2);
        }
        .advanced-cta[data-active="true"] {
          display: none;
        }
        .edit-btn:hover {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb, 0, 255, 65), 0.1);
        }
        /* === Hero controls row (slider) === */
        .hero-controls {
          display: flex;
          align-items: center;
          gap: var(--space-3, 0.75rem);
          flex-wrap: wrap;
          justify-content: center;
        }
        .edit-btn:disabled {
          opacity: 0.4;
          pointer-events: none;
        }

        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          .hero {
            padding: var(--space-4, 1rem) var(--space-3, 0.75rem);
          }
          h1 {
            font-size: var(--text-lg, 1.125rem);
            letter-spacing: 0.04em;
            margin-bottom: 0.5rem;
          }
          .subline {
            font-size: var(--text-xs, 0.75rem);
            margin-bottom: var(--space-3, 0.75rem);
          }
          .features {
            padding: var(--space-3, 0.75rem);
          }
          .precision-label {
            min-width: auto;
            font-size: 12px;
          }
          #precision-slider {
            width: 60px;
          }
          .ws-controls {
            grid-template-columns: 1fr;
          }
          .ws-slider-fixed {
            justify-self: center;
          }
          .ws-action-fixed {
            justify-self: center;
          }
          .ws-precision {
            padding: 0;
            gap: var(--space-1, 0.25rem);
          }
          .workspace {
            padding: var(--space-2, 0.5rem);
          }
          .edit-btn {
            min-height: 44px;
            font-size: 12px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          .hero {
            padding: var(--space-5, 1.25rem) var(--space-4, 1rem);
          }
          h1 {
            font-size: var(--text-xl, 1.25rem);
          }
          .subline {
            font-size: var(--text-xs, 0.75rem);
          }
          .features {
            padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
          }
          .edit-btn {
            min-height: 44px;
          }
        }

        /* === Touch targets === */
        @media (pointer: coarse) {
          .edit-btn {
            min-height: 44px;
            min-width: 44px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .edit-btn {
            transition: none !important;
          }
        }

        /* Command bar at workspace top (#71) */
        .command-bar {
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
        .cmd-left {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          color: var(--color-text-secondary, #00dd44);
          min-width: 0;
          flex: 1 1 auto;
        }
        .cmd-prompt { color: var(--color-text-tertiary, #00b34a); }
        .cmd-action { color: var(--color-text-secondary, #00dd44); }
        .cmd-filename {
          color: var(--color-accent-primary, #00ff41);
          font-weight: 600;
          max-width: 240px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cmd-meta { color: var(--color-text-tertiary, #00b34a); }
        .cmd-state {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
        }
        .cmd-state-dot {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 4px var(--color-accent-glow, rgba(0, 255, 65, 0.35));
          animation: cmd-pulse 1.4s ease-in-out infinite;
        }
        .cmd-state[data-state="ready"] .cmd-state-dot { animation: none; }
        .cmd-state[data-state="failed"] .cmd-state-dot { color: var(--color-error, #ff3131); animation: none; }
        .cmd-state-label { color: var(--color-text-tertiary, #00b34a); }
        @keyframes cmd-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cmd-state-dot { animation: none !important; }
        }
        .cmd-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .cmd-btn {
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
        .cmd-btn:hover:not(:disabled),
        .cmd-btn:focus-visible {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          outline: none;
        }
        .cmd-btn-danger {
          color: var(--color-error, #ff3131);
          border-color: var(--color-error, #ff3131);
        }
        .cmd-btn-danger:hover:not(:disabled),
        .cmd-btn-danger:focus-visible {
          color: var(--color-error, #ff3131);
          border-color: var(--color-error, #ff3131);
          background: rgba(255, 49, 49, 0.08);
        }
        @media (pointer: coarse) {
          .cmd-btn { min-height: 44px; min-width: 88px; }
        }
        @media (max-width: 480px) {
          .command-bar { padding: 6px 10px; gap: 8px; }
          .cmd-filename { max-width: 160px; }
        }

        /* === Error modal === */
        .error-modal[hidden] { display: none !important; }
        .error-modal {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-4, 1rem);
        }
        .error-modal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
        }
        .error-modal-dialog {
          position: relative;
          max-width: 520px;
          width: 100%;
          background: var(--color-bg-primary, #000);
          border: 1px solid var(--color-error, #ff3131);
          padding: var(--space-5, 1.25rem);
          font-family: 'JetBrains Mono', monospace;
          color: var(--color-text-primary, #00ff41);
          box-shadow: 0 0 24px rgba(255, 49, 49, 0.25);
        }
        .error-modal-title {
          margin: 0 0 var(--space-3, 0.75rem);
          font-size: 16px;
          font-weight: 600;
          color: var(--color-error, #ff3131);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .error-modal-message {
          margin: 0 0 var(--space-4, 1rem);
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-text-secondary, #00dd44);
          word-break: break-word;
        }
        .error-modal-actions {
          display: flex;
          gap: var(--space-2, 0.5rem);
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .error-modal-btn {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          padding: 8px 16px;
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          cursor: pointer;
          min-height: 40px;
        }
        .error-modal-btn:hover,
        .error-modal-btn:focus-visible {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          outline: none;
        }
        .error-modal-btn.primary {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
        }
        .error-modal-btn.primary:hover,
        .error-modal-btn.primary:focus-visible {
          background: var(--color-accent-muted, rgba(0, 255, 65, 0.08));
        }
        @media (pointer: coarse) {
          .error-modal-btn { min-height: 44px; min-width: 88px; }
        }
`;
