import { PipelineOrchestrator, PipelineAbortError } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import { t } from '../i18n';
import { isAppInstalled } from '../sw-register';
import { AppInstaller } from '../controllers/app-install';
import type { ArViewer } from './ar-viewer';
import type { ArProgress } from './ar-progress';
import type { ArDownload } from './ar-download';
import type { ArEditor } from './ar-editor';
import type { ArDropzone } from './ar-dropzone';
import type { ArBatchGrid } from './ar-batch-grid';
import { BatchOrchestrator, type BatchStageCallback } from '../controllers/batch-orchestrator';
import { emit, on } from '../lib/event-bus';
import { refineEdges } from '../pipeline/finalize';
import { finalizePipelineResult } from '../pipeline/finalize-result';
import { exportPng } from '../utils/image-io';
import type { ArEditorAdvanced } from './ar-editor-advanced';

export class ArApp extends HTMLElement {
  private static readonly MODEL_ID: ModelId = 'briaai/RMBG-1.4';
  private pipeline: PipelineOrchestrator | null = null;
  private viewer!: ArViewer;
  private progress!: ArProgress;
  private download!: ArDownload;
  private editor!: ArEditor;
  private dropzone!: ArDropzone;
  private currentFileName = 'image.png';
  private currentImageData: ImageData | null = null;
  private currentOriginalImageData: ImageData | null = null;
  private currentFileSize = 0;
  private lastResultImageData: ImageData | null = null;
  private isProcessing = false;
  private processingAborted = false;
  /** AbortController for the currently-running pipeline. Fires when the
   * user drops a new image mid-process or navigates away, so in-flight
   * worker CPU stops immediately instead of finishing a doomed run. */
  private processingAbortController: AbortController | null = null;
  private preEditResult: ImageData | null = null;
  private cachedEditResult: ImageData | null = null;
  private abortController: AbortController | null = null;
  /** Owns PWA install button + guide wiring. Initialized in
   *  setupComponents() once the install-btn / install-guide nodes
   *  exist. See #47/Phase-1b. */
  private installer!: AppInstaller;
  private batchGrid: ArBatchGrid | null = null;
  /** Owns batch queue state + per-item processing loop. Wired up in
   *  setupComponents() once UI refs are resolved. See #47/Phase-1. */
  private batch!: BatchOrchestrator;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.abortController = new AbortController();
    this.render();
    this.setupComponents();
    this.setupEvents();
    this.preloadModel();
  }

  /** Pre-load model + warmup as soon as page opens */
  private preloadModel(): void {
    // Status line: terse "loading..." while warming, "Ready to nuke"
    // when done. Detailed % progress lives inside the dropzone slot —
    // see ar-dropzone.setLoadingState() — so the status line never
    // duplicates the percentage.
    const statusEl = () => this.shadowRoot?.querySelector('#status-model');
    let firstRunSettled = false;

    this.pipeline = new PipelineOrchestrator(
      (_stage: PipelineStage, _status: StageStatus, message?: string) => {
        if (firstRunSettled) return;
        const m = message?.match(/(\d+)\s*%/);
        if (!m) return;
        const pct = Math.min(100, Math.max(0, parseInt(m[1], 10)));
        this.dropzone.setLoadingState({ visible: true, pct, label: message });
      },
    );

    const el = statusEl();
    if (el) el.textContent = t('status.model.loading');

    // Dropzone is disabled while warming; the loading slot replaces
    // its idle CTAs with a progress bar in the same vertical space so
    // nothing reflows when the model finishes.
    this.dropzone.setEnabled(false);

    // Cold-cache detection: if we haven't settled within 400 ms,
    // surface the in-dropzone progress panel. Instant cache hits never
    // expose the panel.
    const revealTimer = window.setTimeout(() => {
      if (!firstRunSettled) this.dropzone.setLoadingState({ visible: true });
    }, 400);

    const finish = (ready: boolean): void => {
      firstRunSettled = true;
      window.clearTimeout(revealTimer);
      this.dropzone.setLoadingState({ visible: false, ready });
    };

    this.pipeline
      .preloadModel(ArApp.MODEL_ID)
      .then(() => {
        finish(true);
        const s = statusEl();
        if (s) {
          (s as HTMLElement).dataset.state = 'ready';
          s.textContent = t('hero.modelStatus');
          s.classList.add('ready');
        }
        const r = this.shadowRoot?.querySelector('#status-reactor') as HTMLElement | null;
        if (r) {
          r.dataset.state = 'online';
          r.textContent = t('status.reactor.online');
        }
        this.dropzone.setEnabled(true);
      })
      .catch((err: unknown) => {
        finish(false);
        console.error('[NukeBG] Model preload failed, falling back to lazy load:', err);
        const s = statusEl();
        if (s) {
          (s as HTMLElement).dataset.state = 'lazy';
          s.textContent = t('status.model.lazy');
        }
        // Reactor stays "offline" — preload didn't resolve. The lazy-load
        // path will flip it once the first real process() succeeds; until
        // then the user sees an honest "reactor idle" state.
        this.dropzone.setEnabled(true);
      });
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
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
        .hero-disclaimer,
        .hero-support {
          margin: 6px 0 0;
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
      </style>

      <!-- Full-bleed marquee outside the main column per design #69.
           Gradient mask fades text in/out at the edges so it never
           clips mid-word the way the old column-scoped marquee did. -->
      <div class="marquee-bleed" id="precision-marquee-bleed"><span><span class="marquee-half">☢ NUKEBG | DROP. NUKE. DOWNLOAD. | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢</span><span class="marquee-half" aria-hidden="true">☢ NUKEBG | DROP. NUKE. DOWNLOAD. | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢</span></span></div>

      <section class="hero" id="hero">
        <h1>
          <span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>
          <span class="hero-title-short"><span class="accent">${t('hero.title.short')}</span></span>
        </h1>
        <p class="subline">
          <span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>
          <span class="subline-short"># ${t('hero.subtitle.short')}</span>
        </p>
        <ar-dropzone></ar-dropzone>
        <ar-batch-grid id="batch-grid" style="display:none"></ar-batch-grid>

        <button class="install-btn" id="install-btn" aria-label="${t('pwa.install')}">${isAppInstalled() ? t('pwa.installed') : t('pwa.install')}</button>
        <div class="install-guide" id="install-guide"></div>
      </section>

      <section class="workspace" id="workspace" aria-label="Image processing workspace">
        <div class="workspace-inner">
          <div class="batch-detail-bar" id="batch-detail-bar" style="display:none">
            <button class="back-to-grid-btn" id="back-to-grid-btn">${t('batch.backToGrid')}</button>
          </div>
          <div class="batch-failed-bar" id="batch-failed-bar" style="display:none">
            <button class="batch-retry-btn" id="batch-retry-btn">${t('batch.retry')}</button>
            <button class="batch-discard-btn" id="batch-discard-btn">${t('batch.discard')}</button>
          </div>
          <div class="single-file-workspace" id="single-file-workspace">
          <!-- Two-column workspace at ≥ 900 px: viewer on the left,
               action column (download, edit, advanced) on the right
               so the result gets immediate presence next to the
               delivery mechanism. At smaller widths the column
               collapses below the viewer and everything stacks. (#75) -->
          <div class="ws-result-grid">
            <div class="ws-viewer-col">
              <ar-viewer></ar-viewer>
              <ar-progress></ar-progress>
            </div>
            <div class="ws-action-col" id="ws-action-col">
              <ar-download></ar-download>
              <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
              <p class="advanced-prompt" id="advanced-prompt" style="display:none">${t('advanced.cta')}</p>
              <button class="advanced-cta" id="advanced-cta" style="display:none">${t('advanced.btn')}</button>
            </div>
          </div>
          <!-- Command bar moved BELOW the viewer / action grid: the
               user did not want "$ nukea file.png · ... · ready"
               appearing ABOVE the image when processing finished or
               was cancelled. The bar still owns the same status
               role / aria-live region; only the DOM position
               changed. -->
          <div class="command-bar" id="command-bar" role="status" aria-live="polite">
            <div class="cmd-left">
              <span class="cmd-prompt">$</span>
              <span class="cmd-action">nukea</span>
              <span class="cmd-filename" id="cmd-filename">image.png</span>
              <span class="cmd-meta" id="cmd-meta"></span>
              <span class="cmd-state" id="cmd-state" hidden>
                <span class="cmd-state-dot">●</span>
                <span class="cmd-state-label" id="cmd-state-label">${t('cmdbar.running')}</span>
              </span>
            </div>
          </div>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
          <ar-editor-advanced id="editor-advanced"></ar-editor-advanced>
          </div>
        </div>
      </section>

      <!-- Status panel: placed BELOW the workspace so it always reads
           "in context" of the current image (or sits below the dropzone
           on the landing screen, since .workspace is display:none until
           a file is dropped). Lifted out of section.hero on purpose —
           that section gets a .hidden class toggled when the workspace
           takes over, which used to make the [STATUS] line and the
           honesty copy disappear during processing. The
           .status-panel.editor-open rule hides this block while the
           advanced editor is open (the only state where the user
           actively does NOT want the [STATUS] / Ko-fi noise on screen).
           Class names and IDs kept (.status-line, .hero-disclaimer,
           .hero-support) so existing CSS selectors and the regex-based
           component tests still match. -->
      <aside class="status-panel" id="status-panel">
        <p class="status-line" id="status-line">
          <span class="status-tag">[STATUS]</span>
          <span class="status-dot">●</span>
          <span class="status-reactor" id="status-reactor" data-state="offline">${t('status.reactor.offline')}</span>
          <span class="status-sep">|</span>
          <span class="status-model" id="status-model" data-state="loading">${t('status.model.loading')}</span>
          <span class="status-sep">|</span>
          <details class="status-details">
            <summary id="status-limits-summary"># ${t('status.limitations')}</summary>
            <div class="status-limits-body" id="status-limits-body">${t('features.limitations')}</div>
          </details>
        </p>
        <p class="hero-disclaimer" id="hero-disclaimer">${t('features.disclaimer')}</p>
        <p class="hero-support" id="hero-support">${t('support.kofi')}</p>
      </aside>

      <div
        class="error-modal"
        id="error-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-modal-title"
        aria-describedby="error-modal-message"
        hidden
      >
        <div class="error-modal-backdrop" id="error-modal-backdrop"></div>
        <div class="error-modal-dialog">
          <h2 class="error-modal-title" id="error-modal-title">${t('error.title')}</h2>
          <p class="error-modal-message" id="error-modal-message"></p>
          <div class="error-modal-actions">
            <button type="button" class="error-modal-btn primary" id="error-modal-retry">${t('error.retry')}</button>
            <button type="button" class="error-modal-btn" id="error-modal-dismiss">${t('error.dismiss')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private setupComponents(): void {
    this.viewer = this.shadowRoot!.querySelector('ar-viewer')!;
    this.progress = this.shadowRoot!.querySelector('ar-progress')!;
    this.download = this.shadowRoot!.querySelector('ar-download')!;
    this.editor = this.shadowRoot!.querySelector('ar-editor')!;
    this.dropzone = this.shadowRoot!.querySelector('ar-dropzone')! as ArDropzone;
    this.batchGrid = this.shadowRoot!.querySelector('#batch-grid') as ArBatchGrid;

    // PWA install button + guide controller. Lifetime tied to ar-app
    // via the AbortSignal handed to attach() in setupEvents().
    const installBtn = this.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
    const installGuide = this.shadowRoot!.querySelector('#install-guide') as HTMLDivElement;
    this.installer = new AppInstaller(installBtn, installGuide);

    // Batch orchestrator owns queue state + per-item processing. Host
    // (this component) keeps the pipeline + AbortController + thumbnail
    // helper + UI swap, exposed through the BatchHost interface.
    this.batch = new BatchOrchestrator(
      {
        viewer: this.viewer,
        progress: this.progress,
        download: this.download,
        batchGrid: this.batchGrid,
      },
      {
        installBatchStageCallback: (cb: BatchStageCallback) => {
          if (!this.pipeline) {
            this.pipeline = new PipelineOrchestrator(cb);
          } else {
            this.pipeline.setStageCallback(cb);
          }
          return this.pipeline;
        },
        setProcessingAbortController: (c) => {
          this.processingAbortController = c;
        },
        makeThumbnail: (img, maxSide) => this.makeThumbnail(img, maxSide),
        enterGridMode: () => this.setBatchUiMode('grid'),
      },
    );
    // When an item finishes mid-processing AND the user is watching its
    // detail view, re-render so they see the result/error without going
    // back to the grid.
    this.batch.setOnItemRefreshed((id) => this.openBatchDetail(id));
  }

  /** Actualiza textos sin re-renderizar todo el componente */
  private updateTexts(): void {
    const root = this.shadowRoot!;
    const h1 = root.querySelector('h1');
    if (h1)
      h1.innerHTML =
        `<span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>` +
        `<span class="hero-title-short"><span class="accent">${t('hero.title.short')}</span></span>`;
    const subline = root.querySelector('.subline');
    if (subline)
      subline.innerHTML =
        `<span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>` +
        `<span class="subline-short"># ${t('hero.subtitle.short')}</span>`;
    const statusReactor = root.querySelector('#status-reactor');
    if (statusReactor) {
      const state = (statusReactor as HTMLElement).dataset.state ?? 'offline';
      statusReactor.textContent = t(
        state === 'online' ? 'status.reactor.online' : 'status.reactor.offline',
      );
    }
    const statusModel = root.querySelector('#status-model');
    if (statusModel) {
      const state = (statusModel as HTMLElement).dataset.state ?? 'loading';
      const key =
        state === 'ready'
          ? 'hero.modelStatus'
          : state === 'lazy'
            ? 'status.model.lazy'
            : 'status.model.loading';
      statusModel.textContent = t(key);
    }
    const heroDisclaimer = root.querySelector('#hero-disclaimer');
    if (heroDisclaimer) heroDisclaimer.innerHTML = t('features.disclaimer');
    const heroSupport = root.querySelector('#hero-support');
    if (heroSupport) heroSupport.innerHTML = t('support.kofi');
    const statusLimSum = root.querySelector('#status-limits-summary');
    if (statusLimSum) statusLimSum.textContent = `# ${t('status.limitations')}`;
    const statusLimBody = root.querySelector('#status-limits-body');
    if (statusLimBody) statusLimBody.innerHTML = t('features.limitations');
    const editBtn = root.querySelector('#edit-btn');
    if (editBtn) editBtn.textContent = this.preEditResult ? t('edit.discard') : t('edit.btn');
    const advancedPrompt = root.querySelector('#advanced-prompt');
    if (advancedPrompt) advancedPrompt.textContent = t('advanced.cta');
    const advancedBtn = root.querySelector('#advanced-cta');
    if (advancedBtn) advancedBtn.textContent = t('advanced.btn');
    this.installer?.refreshText();
    const backBtnEl = root.querySelector('#back-to-grid-btn');
    if (backBtnEl) backBtnEl.textContent = t('batch.backToGrid');
    const retryBtnEl = root.querySelector('#batch-retry-btn');
    if (retryBtnEl) retryBtnEl.textContent = t('batch.retry');
    const discardBtnEl = root.querySelector('#batch-discard-btn');
    if (discardBtnEl) discardBtnEl.textContent = t('batch.discard');
    const errTitle = root.querySelector('#error-modal-title');
    if (errTitle) errTitle.textContent = t('error.title');
    const errRetry = root.querySelector('#error-modal-retry');
    if (errRetry) errRetry.textContent = t('error.retry');
    const errDismiss = root.querySelector('#error-modal-dismiss');
    if (errDismiss) errDismiss.textContent = t('error.dismiss');
    const cmdStateLabel = root.querySelector('#cmd-state-label') as HTMLElement | null;
    const cmdStateHost = root.querySelector('#cmd-state') as HTMLElement | null;
    if (cmdStateLabel && cmdStateHost) {
      const state = cmdStateHost.getAttribute('data-state') ?? 'running';
      const key =
        state === 'running'
          ? 'cmdbar.running'
          : state === 'ready'
            ? 'cmdbar.ready'
            : 'cmdbar.failed';
      cmdStateLabel.textContent = t(key);
    }
  }

  private setupEvents(): void {
    // Hoisted once so every addEventListener below can reuse it for
    // component-lifecycle cleanup via AbortSignal.
    const signal = this.abortController!.signal;

    on(document, 'nukebg:locale-changed', () => this.updateTexts(), { signal });

    // The cmdbar Cancel button was removed (the abort path it triggered
    // was confusing in practice — workers stopped but state surfaces did
    // not always settle predictably). The underlying
    // processingAbortController is still alive and used by the
    // "drop a new image mid-process" and batch-cancel paths, so the
    // pipeline can still be torn down by other code; only the user-
    // facing button is gone.

    // #78 — inline error-stage actions in ar-progress. Retry reuses
    // the existing retryFromError() path; report opens a pre-filled
    // GitHub issue URL with browser + session hints; reload is
    // handled by ar-progress itself (location.reload).
    on(this.progress, 'ar:stage-retry', () => this.retryFromError(), { signal });
    on(
      this.progress,
      'ar:stage-report',
      ({ stage }) => {
        const ua = encodeURIComponent(navigator.userAgent);
        const title = encodeURIComponent(`[stage:${stage}] pipeline error`);
        const body = encodeURIComponent(
          `**Stage:** \`${stage}\`\n**UA:** ${decodeURIComponent(ua)}\n**Locale:** ${document.documentElement.lang}\n\n<!-- what were you trying to do? drag the image that failed if possible -->`,
        );
        window.open(
          `https://github.com/yocreoquesi/nukebg/issues/new?title=${title}&body=${body}`,
          '_blank',
          'noopener',
        );
      },
      { signal },
    );

    // Error modal wiring (#36).
    const retryBtn = this.shadowRoot!.querySelector(
      '#error-modal-retry',
    ) as HTMLButtonElement | null;
    const dismissBtn = this.shadowRoot!.querySelector(
      '#error-modal-dismiss',
    ) as HTMLButtonElement | null;
    const backdrop = this.shadowRoot!.querySelector('#error-modal-backdrop') as HTMLElement | null;
    retryBtn?.addEventListener('click', () => this.retryFromError());
    dismissBtn?.addEventListener('click', () => this.hideErrorModal());
    backdrop?.addEventListener('click', () => this.hideErrorModal());
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
      if (modal && !modal.hasAttribute('hidden')) {
        e.preventDefault();
        this.hideErrorModal();
      }
    });

    // PWA install button + guide — controller owns the wiring and uses
    // the same AbortSignal so cleanup is automatic on disconnect.
    this.installer.attach(signal);

    on(
      this.shadowRoot!,
      'ar:image-loaded',
      async (detail) => {
        this.currentFileName = detail.file.name || 'image.png';

        // If currently processing, abort the in-flight pipeline and reset
        if (this.isProcessing) {
          this.processingAborted = true;
          this.isProcessing = false;
          this.enableWorkspaceButtons();
        }

        await this.processImage(
          detail.imageData,
          detail.originalImageData ?? detail.imageData,
          detail.file.size,
        );
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'ar:images-loaded',
      async (detail) => {
        if (this.isProcessing) {
          this.processingAborted = true;
          this.isProcessing = false;
          this.enableWorkspaceButtons();
        }
        await this.batch.start(detail.images);
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:item-click',
      ({ id }) => {
        this.openBatchDetail(id);
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:download-zip',
      async () => {
        await this.batch.downloadZip();
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:cancel',
      () => {
        this.resetToIdle();
      },
      { signal },
    );

    const backBtn = this.shadowRoot!.querySelector('#back-to-grid-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.closeBatchDetail(), { signal });
    }
    const batchRetryBtn = this.shadowRoot!.querySelector('#batch-retry-btn');
    if (batchRetryBtn) {
      batchRetryBtn.addEventListener('click', () => this.retryBatchItem(), { signal });
    }
    const discardBtn = this.shadowRoot!.querySelector('#batch-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => this.discardBatchItem(), { signal });
    }

    on(
      this.shadowRoot!,
      'ar:process-another',
      () => {
        this.resetToIdle();
      },
      { signal },
    );

    // Disclaimer click - toggle limitations detail
    // Limitations now live inside <details id="status-limits"> — native
    // disclosure widget handles open/close. No click wiring needed.

    // Edit button - opens editor or discards edits
    this.shadowRoot!.querySelector('#edit-btn')?.addEventListener(
      'click',
      async () => {
        if (!this.lastResultImageData) return;

        if (this.preEditResult) {
          // Discard mode: restore pre-edit result, cache edit for instant re-apply
          this.cachedEditResult = this.lastResultImageData;
          this.lastResultImageData = this.preEditResult;
          this.preEditResult = null;

          const blob = await exportPng(this.lastResultImageData);
          const originalForViewer = this.currentOriginalImageData ?? this.currentImageData;
          if (originalForViewer) this.viewer.setOriginal(originalForViewer, this.currentFileSize);
          this.viewer.setResult(this.lastResultImageData, blob);
          await this.download.setResult(this.lastResultImageData, this.currentFileName, 0, blob);

          // Switch button back to "Edit manually"
          const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
          if (editBtn) editBtn.textContent = t('edit.btn');
        } else {
          // Edit mode: open editor, pass cached edit result for instant toggle if available
          const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
          editorSection.style.display = 'block';
          this.editor.setImage(
            this.cachedEditResult ?? this.lastResultImageData,
            (this.currentOriginalImageData ?? this.currentImageData)!,
          );
          this.cachedEditResult = null;
          (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'none';
        }
      },
      { signal },
    );

    // Editor cancel - discard edits, close editor
    on(
      this.shadowRoot!,
      'ar:editor-cancel',
      () => {
        (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
        (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'block';
      },
      { signal },
    );

    // Editor done - update viewer and download with edited result
    on(
      this.shadowRoot!,
      'ar:editor-done',
      async ({ imageData: rawEdited }) => {
        // Refine: foreground decontamination + quintic alpha sharpening so manual
        // brush strokes inherit the same studio-quality edge as the main pipeline.
        // Topology cleanup is skipped — keepLargestComponent would discard manual
        // restores that don't connect to the main subject body.
        const editedData = await refineEdges(this.pipeline, rawEdited, {
          skipTopologyCleanup: true,
        });
        const blob = await exportPng(editedData);

        // Save pre-edit for discard functionality
        this.preEditResult = this.lastResultImageData;
        this.cachedEditResult = editedData;
        this.lastResultImageData = editedData;

        // "Before" stays as the original input image; only "after" updates
        this.viewer.setResult(editedData, blob);
        await this.download.setResult(editedData, this.currentFileName, 0, blob);

        // Hide editor, show discard button
        (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
        const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
        editBtn.style.display = 'block';
        editBtn.textContent = t('edit.discard');
      },
      { signal },
    );

    // Advanced editor CTA toggle
    this.shadowRoot!.querySelector('#advanced-cta')?.addEventListener(
      'click',
      () => {
        const adv = this.shadowRoot!.querySelector('#editor-advanced') as ArEditorAdvanced | null;
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        if (!adv || !btn) return;
        const isOpen = adv.hasAttribute('active');
        if (isOpen) {
          adv.removeAttribute('active');
          btn.removeAttribute('data-active');
          this.setEditorOpen(false);
          return;
        }
        const current = this.lastResultImageData ?? this.currentImageData;
        const original = this.currentOriginalImageData ?? this.currentImageData;
        if (!current || !original) return;
        adv.setImage(current, original);
        adv.setAttribute('active', '');
        btn.setAttribute('data-active', 'true');
        this.setEditorOpen(true);
        adv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      { signal },
    );

    // Advanced editor — cancel
    on(
      this.shadowRoot!,
      'ar:advanced-cancel',
      () => {
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        btn?.removeAttribute('data-active');
        this.setEditorOpen(false);
      },
      { signal },
    );

    // Advanced editor — done
    on(
      this.shadowRoot!,
      'ar:advanced-done',
      async ({ imageData }) => {
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        btn?.removeAttribute('data-active');
        this.setEditorOpen(false);

        // Same reasoning as the basic editor: skip topology cleanup so the
        // user's lasso crops / restores survive the refinement pass.
        const refined = await refineEdges(this.pipeline, imageData, {
          skipTopologyCleanup: true,
        });
        const blob = await exportPng(refined);
        this.viewer.setResult(refined, blob);
        await this.download.setResult(refined, this.currentFileName, 0, blob);
        this.lastResultImageData = refined;
      },
      { signal },
    );
  }

  // Advanced CTA replaces the edit-btn when visible. The Editor button
  // and its #advanced-prompt sentence ("Not satisfied with the
  // result?" / equivalent locale) appear together — the prompt lives
  // outside the button so the button label stays tight.
  private setAdvancedBtnVisible(show: boolean): void {
    const cta = this.shadowRoot?.querySelector('#advanced-cta') as HTMLElement | null;
    const prompt = this.shadowRoot?.querySelector('#advanced-prompt') as HTMLElement | null;
    const editBtn = this.shadowRoot?.querySelector('#edit-btn') as HTMLElement | null;
    if (!cta) return;
    cta.style.display = show ? 'block' : 'none';
    if (prompt) prompt.style.display = show ? 'block' : 'none';
    if (editBtn) editBtn.style.display = 'none';
  }

  /** Toggle the .editor-open class on the persistent status panel.
   *  When the advanced editor is open, the user does not want the
   *  [STATUS] line / limitations / Ko-fi pitch competing for attention
   *  with the editing surface. Every code path that mutates the
   *  advanced editor's `active` attribute also calls this helper. */
  private setEditorOpen(open: boolean): void {
    const panel = this.shadowRoot?.querySelector('#status-panel') as HTMLElement | null;
    if (!panel) return;
    panel.classList.toggle('editor-open', open);
  }

  /** Disable all workspace action buttons during processing */
  private disableWorkspaceButtons(): void {
    const root = this.shadowRoot!;
    const editBtn = root.querySelector('#edit-btn') as HTMLButtonElement | null;
    if (editBtn) editBtn.disabled = true;
    // Buttons inside ar-download shadow DOM
    const downloadRoot = this.download.shadowRoot;
    if (downloadRoot) {
      const dlBtn = downloadRoot.querySelector('#download-btn') as HTMLElement | null;
      if (dlBtn) {
        dlBtn.setAttribute('aria-disabled', 'true');
        dlBtn.style.pointerEvents = 'none';
        dlBtn.style.opacity = '0.4';
      }
      const copyBtn = downloadRoot.querySelector('#copy-btn') as HTMLButtonElement | null;
      if (copyBtn) copyBtn.disabled = true;
      const anotherBtn = downloadRoot.querySelector('#another-btn') as HTMLButtonElement | null;
      if (anotherBtn) anotherBtn.disabled = true;
    }
  }

  /** Re-enable all workspace action buttons after processing */
  private enableWorkspaceButtons(): void {
    const root = this.shadowRoot!;
    const editBtn = root.querySelector('#edit-btn') as HTMLButtonElement | null;
    if (editBtn) editBtn.disabled = false;
    // Buttons inside ar-download shadow DOM
    const downloadRoot = this.download.shadowRoot;
    if (downloadRoot) {
      const dlBtn = downloadRoot.querySelector('#download-btn') as HTMLElement | null;
      if (dlBtn) {
        dlBtn.removeAttribute('aria-disabled');
        dlBtn.style.pointerEvents = '';
        dlBtn.style.opacity = '';
      }
      const copyBtn = downloadRoot.querySelector('#copy-btn') as HTMLButtonElement | null;
      if (copyBtn) copyBtn.disabled = false;
      const anotherBtn = downloadRoot.querySelector('#another-btn') as HTMLButtonElement | null;
      if (anotherBtn) anotherBtn.disabled = false;
    }
  }

  private async processImage(
    imageData: ImageData,
    originalImageData: ImageData,
    fileSize: number,
  ): Promise<void> {
    // If a previous run is still going, hard-abort it so workers stop
    // immediately. Dropping a new image always wins over the previous one.
    if (this.processingAbortController && !this.processingAbortController.signal.aborted) {
      this.processingAbortController.abort('new image dropped');
    }
    this.processingAbortController = new AbortController();
    this.processingAborted = false;
    this.isProcessing = true;
    this.disableWorkspaceButtons();

    this.currentImageData = imageData;
    this.currentOriginalImageData = originalImageData;
    this.currentFileSize = fileSize;

    this.preEditResult = null;
    this.cachedEditResult = null;
    this.lastResultImageData = null;
    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    hero.classList.add('hidden');
    workspace.classList.add('visible');

    this.viewer.clearResult();
    // Show the full-resolution original in the viewer regardless of
    // whether the pipeline worked on a downscaled copy.
    this.viewer.setOriginal(originalImageData, fileSize);
    this.progress.reset();
    this.progress.setRunning(true);
    this.updateCommandBar({
      filename: this.currentFileName,
      width: originalImageData.width,
      height: originalImageData.height,
      sizeBytes: fileSize,
      state: 'running',
    });
    this.download.reset();

    // Reuse existing pipeline (keeps model loaded)
    if (!this.pipeline) {
      this.pipeline = new PipelineOrchestrator(
        (stage: PipelineStage, status: StageStatus, message?: string) => {
          this.progress.setStage(stage, status, message);
        },
      );
    } else {
      // Update the callback to point to current progress component
      this.pipeline.setStageCallback(
        (stage: PipelineStage, status: StageStatus, message?: string) => {
          this.progress.setStage(stage, status, message);
        },
      );
    }

    try {
      if (
        originalImageData.width !== imageData.width ||
        originalImageData.height !== imageData.height
      ) {
        const msg = t('progress.downscaled', {
          w: String(imageData.width),
          h: String(imageData.height),
          ow: String(originalImageData.width),
          oh: String(originalImageData.height),
        });
        console.info(`[NukeBG] ${msg}`);
      }

      const result = await this.pipeline.process(
        imageData,
        ArApp.MODEL_ID,
        'high-power',
        this.processingAbortController?.signal,
      );
      if (this.processingAborted) return;

      const finalImageData = finalizePipelineResult(result, originalImageData);
      const nukedPct = result.nukedPct;
      const totalTimeMs = result.totalTimeMs;

      if (this.processingAborted) return;

      const blob = await exportPng(finalImageData);
      if (this.processingAborted) return;

      this.viewer.setResult(finalImageData, blob);
      await this.download.setResult(finalImageData, this.currentFileName, totalTimeMs, blob);
      if (this.processingAborted) return;

      // Show nuke percentage if background was removed
      if (nukedPct > 0) {
        this.progress.setStage('ml-segmentation', 'done', `${nukedPct}% nuked`);
      }

      this.lastResultImageData = finalImageData;

      // Show edit button
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'block';
      this.setAdvancedBtnVisible(true);
      // Hide editor if it was open from a previous edit
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
    } catch (err) {
      if (this.processingAborted) return;
      // Abort is an expected outcome from "new image dropped" or
      // "batch aborted" — the new run that follows owns the UI from
      // there. Silent return. (The previous cmdbar Cancel button was
      // removed; user-initiated cancel is no longer a path here.)
      if (err instanceof PipelineAbortError) return;
      console.error('Pipeline error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.progress.setStage('ml-segmentation', 'error', t('pipeline.error', { msg }));
      this.updateCommandBarState('failed');
      this.showErrorModal(msg);
    } finally {
      this.progress.setRunning(false);
      if (!this.processingAborted) {
        this.isProcessing = false;
        this.enableWorkspaceButtons();
        this.updateCommandBarState('ready');
        // Notify the post-process CTA module so it can decide whether
        // to surface a star/tip/review ask. Light DOM listener — fires
        // and forgets, no return contract.
        emit(document, 'ar:nuke-success', undefined);
      }
    }
  }

  /**
   * Update the command-bar contents (#71). Called when a new image
   * lands in the workspace. The `state` drives the visible dot + label
   * and whether the Cancel button is exposed.
   */
  private updateCommandBar(payload: {
    filename: string;
    width: number;
    height: number;
    sizeBytes: number;
    state: 'running' | 'ready' | 'failed';
  }): void {
    const root = this.shadowRoot!;
    const fn = root.querySelector('#cmd-filename');
    if (fn) fn.textContent = payload.filename;
    const meta = root.querySelector('#cmd-meta');
    if (meta) {
      const kb = payload.sizeBytes > 0 ? ` · ${this.formatBytes(payload.sizeBytes)}` : '';
      meta.textContent = ` · ${payload.width}×${payload.height}${kb}`;
    }
    this.updateCommandBarState(payload.state);
  }

  private updateCommandBarState(state: 'running' | 'ready' | 'failed'): void {
    const root = this.shadowRoot!;
    const stateEl = root.querySelector('#cmd-state') as HTMLElement | null;
    const label = root.querySelector('#cmd-state-label');
    if (!stateEl || !label) return;
    stateEl.hidden = false;
    stateEl.setAttribute('data-state', state);
    const key =
      state === 'running' ? 'cmdbar.running' : state === 'ready' ? 'cmdbar.ready' : 'cmdbar.failed';
    label.textContent = t(key);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  /**
   * Show the error modal with the given message. Retry is only
   * meaningful if we still have the source image buffers — otherwise
   * the button hides itself and the user can only dismiss.
   */
  private showErrorModal(msg: string): void {
    const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
    const messageEl = this.shadowRoot?.querySelector('#error-modal-message');
    const retryBtn = this.shadowRoot?.querySelector(
      '#error-modal-retry',
    ) as HTMLButtonElement | null;
    if (!modal || !messageEl) return;
    messageEl.textContent = msg;
    const canRetry = !!(this.currentImageData && this.currentOriginalImageData);
    if (retryBtn) retryBtn.hidden = !canRetry;
    modal.hidden = false;
    // Shift focus to the primary action so keyboard users can act
    // without hunting for the dialog.
    queueMicrotask(() => {
      (canRetry
        ? retryBtn
        : (this.shadowRoot?.querySelector('#error-modal-dismiss') as HTMLElement | null)
      )?.focus();
    });
  }

  private hideErrorModal(): void {
    const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
    if (modal) modal.hidden = true;
  }

  private retryFromError(): void {
    if (!this.currentImageData || !this.currentOriginalImageData) {
      this.hideErrorModal();
      return;
    }
    this.hideErrorModal();
    // Re-run processing with the same inputs. processImage() already
    // handles the state reset (progress, viewer, abort controller, etc).
    this.processImage(this.currentImageData, this.currentOriginalImageData, this.currentFileSize);
  }

  private makeThumbnail(imageData: ImageData, maxSide = 200): string {
    const { width, height } = imageData;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const src = document.createElement('canvas');
    src.width = width;
    src.height = height;
    src.getContext('2d')!.putImageData(imageData, 0, 0);
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, tw, th);
    return out.toDataURL('image/png');
  }

  private setBatchUiMode(mode: 'grid' | 'detail'): void {
    const root = this.shadowRoot!;
    const hero = root.querySelector('#hero') as HTMLElement;
    const workspace = root.querySelector('#workspace') as HTMLElement;
    const dropzone = root.querySelector('ar-dropzone') as HTMLElement;
    const grid = root.querySelector('#batch-grid') as HTMLElement;
    const single = root.querySelector('#single-file-workspace') as HTMLElement;
    const detailBar = root.querySelector('#batch-detail-bar') as HTMLElement;
    const failedBar = root.querySelector('#batch-failed-bar') as HTMLElement;
    if (mode === 'grid') {
      // Grid lives inside hero in the same slot as the dropzone — swap them in place.
      hero.classList.remove('hidden');
      workspace.classList.remove('visible');
      if (dropzone) dropzone.style.display = 'none';
      grid.style.display = 'block';
      single.style.display = 'none';
      detailBar.style.display = 'none';
      failedBar.style.display = 'none';
    } else {
      // Detail mode: show the per-image workspace, hide the hero so the viewer
      // gets full attention. The batch-detail-bar exposes "back to grid".
      hero.classList.add('hidden');
      workspace.classList.add('visible');
      if (dropzone) dropzone.style.display = 'none';
      grid.style.display = 'none';
      single.style.display = 'flex';
      detailBar.style.display = 'flex';
    }
    this.batch.setMode(mode);
  }

  private async openBatchDetail(id: string): Promise<void> {
    const item = this.batch.findItem(id);
    if (!item) return;
    this.batch.setDetailId(id);

    const failedBar = this.shadowRoot!.querySelector('#batch-failed-bar') as HTMLElement;
    const retryBtn = this.shadowRoot!.querySelector('#batch-retry-btn') as HTMLElement;
    this.setBatchUiMode('detail');

    if (item.state === 'processing') {
      // Live progress view: show the original, let the pipeline callback
      // keep updating the progress console, hide result-only actions.
      failedBar.style.display = 'none';
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'running',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      this.download.reset();
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'none';
      this.setAdvancedBtnVisible(false);
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
      return;
    }

    if (item.state === 'failed') {
      failedBar.style.display = 'flex';
      if (retryBtn) retryBtn.style.display = 'inline-block';
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'failed',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      this.download.reset();
      // Replay captured history so the console shows the real sequence
      // (e.g. detect-bg done → watermark-scan done → ml-segmentation error).
      // Fallback for edge cases where nothing was captured: synthesize a
      // single error stage so the user still sees what went wrong.
      if (item.stageHistory.length > 0) {
        this.batch.replayStageHistory(item.stageHistory);
      } else {
        this.progress.reset();
        this.progress.setStage(
          'ml-segmentation',
          'error',
          t('pipeline.error', { msg: item.errorMessage || 'Unknown error' }),
        );
      }
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'none';
      this.setAdvancedBtnVisible(false);
      return;
    }

    if (item.state === 'done' && item.result) {
      // Show discard button (excludes this image from ZIP) but hide retry.
      failedBar.style.display = 'flex';
      if (retryBtn) retryBtn.style.display = 'none';
      this.currentFileName = item.originalName;
      this.currentImageData = item.imageData;
      this.currentOriginalImageData = item.originalImageData;
      this.currentFileSize = item.file.size;
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'ready',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      // Replay per-item stage history so each finished image shows its own
      // icons (done/skipped) and timings — previously we just reset(),
      // which left every stage 'pending' and blanked out every icon.
      this.batch.replayStageHistory(item.stageHistory);
      this.download.reset();
      const finalImageData = item.finalImageData ?? item.result.imageData;
      const blob = await exportPng(finalImageData);
      this.viewer.setResult(finalImageData, blob);
      await this.download.setResult(
        finalImageData,
        item.originalName,
        item.result.totalTimeMs,
        blob,
      );
      this.lastResultImageData = finalImageData;
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'block';
      this.setAdvancedBtnVisible(true);
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
    }
  }

  private closeBatchDetail(): void {
    this.batch.setDetailId(null);
    this.preEditResult = null;
    this.cachedEditResult = null;
    this.lastResultImageData = null;
    this.currentImageData = null;
    this.currentOriginalImageData = null;
    const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
    if (editorSection) editorSection.style.display = 'none';
    const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
    if (editBtn) editBtn.style.display = 'none';
    this.setAdvancedBtnVisible(false);
    const adv = this.shadowRoot!.querySelector('#editor-advanced') as HTMLElement | null;
    adv?.removeAttribute('active');
    this.setEditorOpen(false);
    this.setBatchUiMode('grid');
  }

  private async retryBatchItem(): Promise<void> {
    const id = this.batch.getDetailId();
    if (!id) return;
    this.closeBatchDetail();
    await this.batch.retry(id);
  }

  private discardBatchItem(): void {
    const id = this.batch.getDetailId();
    if (!id) return;
    this.batch.markDiscarded(id);
    this.closeBatchDetail();
  }

  private resetToIdle(): void {
    const root = this.shadowRoot!;
    const hero = root.querySelector('#hero') as HTMLElement;
    const workspace = root.querySelector('#workspace') as HTMLElement;
    const dropzone = root.querySelector('ar-dropzone') as HTMLElement;
    const grid = root.querySelector('#batch-grid') as HTMLElement;
    const single = root.querySelector('#single-file-workspace') as HTMLElement;
    const detailBar = root.querySelector('#batch-detail-bar') as HTMLElement;
    const failedBar = root.querySelector('#batch-failed-bar') as HTMLElement;

    workspace.classList.remove('visible');
    hero.classList.remove('hidden');
    if (dropzone) dropzone.style.display = '';
    if (grid) grid.style.display = 'none';
    if (single) single.style.display = 'flex';
    if (detailBar) detailBar.style.display = 'none';
    if (failedBar) failedBar.style.display = 'none';

    this.download.reset();
    this.preEditResult = null;
    this.cachedEditResult = null;
    this.lastResultImageData = null;
    this.currentImageData = null;
    this.currentOriginalImageData = null;

    if (this.batch.isInBatchMode()) {
      this.batch.abort();
      // Stop the in-flight pipeline run too — otherwise workers keep
      // processing the current item until its natural stage boundary.
      this.processingAbortController?.abort('batch aborted');
      this.batch.reset();
    }
    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
