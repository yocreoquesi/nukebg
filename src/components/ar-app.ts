import { PipelineOrchestrator, PipelineAbortError } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import { t } from '../i18n';
import { installApp, isAppInstalled } from '../sw-register';
import type { ArViewer } from './ar-viewer';
import type { ArProgress } from './ar-progress';
import type { ArDownload } from './ar-download';
import type { ArEditor } from './ar-editor';
import type { ArDropzone } from './ar-dropzone';
import type { ArBatchGrid } from './ar-batch-grid';
import type { BatchItem, StageSnapshot } from '../types/batch';
import { createZip, safeZipEntryName, downloadBlob } from '../utils/zip';
import { refineEdges, dropOrphanBlobs, fillSubjectHoles, promoteSpeckleAlpha } from '../pipeline/finalize';
import { composeAtOriginal } from '../utils/final-composite';
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
  private boundLocaleHandler: (() => void) | null = null;
  private boundPwaInstallableHandler: (() => void) | null = null;
  private abortController: AbortController | null = null;
  private batchGrid: ArBatchGrid | null = null;
  private batchItems: BatchItem[] = [];
  private batchMode: 'off' | 'grid' | 'detail' = 'off';
  private batchDetailId: string | null = null;
  private batchAborted = false;
  /** Item currently being processed by the batch queue. The pipeline stage
   * callback reads this to append snapshots to the right item's history. */
  private batchCurrentProcessingItem: BatchItem | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.abortController = new AbortController();
    // #79 — resolve playful mode before the first render so the rest of
    // the component tree sees the correct `data-playful` attribute.
    this.resolvePlayfulMode();
    this.render();
    this.setupComponents();
    this.setupEvents();
    this.preloadModel();
  }

  /**
   * Decide whether playful (CRT / smoke / vibrate / palette swap) is on.
   * Priority: explicit localStorage pref → prefers-reduced-motion → on.
   */
  private resolvePlayfulMode(): void {
    try {
      const stored = localStorage.getItem('nukebg:playful');
      if (stored === 'true' || stored === 'false') {
        document.documentElement.dataset.playful = stored;
        return;
      }
    } catch {
      // localStorage unavailable (Safari private mode); fall through.
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.dataset.playful = reducedMotion ? 'false' : 'true';
  }

  private setPlayfulMode(playful: boolean): void {
    document.documentElement.dataset.playful = playful ? 'true' : 'false';
    try { localStorage.setItem('nukebg:playful', playful ? 'true' : 'false'); } catch {
      /* ignore storage failures */
    }
    // Sync the footer toggle label.
    this.syncQuietModeToggle();
  }

  private syncQuietModeToggle(): void {
    // Footer lives in light DOM (index.html), not the ar-app shadow root.
    const btn = document.getElementById('quiet-mode-toggle') as HTMLButtonElement | null;
    if (!btn) return;
    const playful = this.isPlayful();
    btn.textContent = playful ? `# ${t('footer.quietMode')}` : `# ${t('footer.playfulMode')}`;
    btn.setAttribute('aria-pressed', playful ? 'false' : 'true');
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
      }
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

    this.pipeline.preloadModel(ArApp.MODEL_ID).then(() => {
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
    }).catch((err: unknown) => {
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
    if (this.boundLocaleHandler) document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
    if (this.boundPwaInstallableHandler) document.removeEventListener('nukebg:pwa-installable', this.boundPwaInstallableHandler);
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
        .marquee-bleed span {
          display: inline-block;
          animation: marquee-scroll 26s linear infinite;
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
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-bleed span { animation: none; }
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
        .crt-word-flicker {
          opacity: 0.05;
        }
        @media (prefers-reduced-motion: reduce) {
          .crt-word-flicker { opacity: 1; }
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
      <div class="marquee-bleed" id="precision-marquee-bleed"><span>☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢ NUKEBG | DROP. NUKE. DOWNLOAD. | <span data-marquee-runtime>development funded for 0 months — tip to extend runway</span> | nukebg.app ☢</span></div>

      <section class="hero" id="hero">
        <h1>
          <span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>
          <span class="hero-title-short"><span class="accent">$ </span>${t('hero.title.short')}</span>
        </h1>
        <p class="subline">
          <span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>
          <span class="subline-short"># ${t('hero.subtitle.short')}</span>
        </p>
        <ar-dropzone></ar-dropzone>
        <ar-batch-grid id="batch-grid" style="display:none"></ar-batch-grid>

        <!-- Consolidated status line replaces model-status + reactor-support
             + features-disclaimer; the honesty copy lives in <details>. -->
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

        <!-- Honesty + support pitch — used to live next to the Reactor
             segmented control. Brought back so the hero still tells the
             user we're not perfect and points at Ko-fi without the
             power-mode machinery. -->
        <p class="hero-disclaimer" id="hero-disclaimer">${t('features.disclaimer')}</p>
        <p class="hero-support" id="hero-support">${t('support.kofi')}</p>

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
            <div class="cmd-right">
              <button type="button" class="cmd-btn cmd-btn-danger" id="cmd-cancel" hidden>${t('cmdbar.cancel')}</button>
            </div>
          </div>
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
              <button class="advanced-cta" id="advanced-cta" style="display:none">${t('advanced.cta')}</button>
            </div>
          </div>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
          <ar-editor-advanced id="editor-advanced"></ar-editor-advanced>
          </div>
        </div>
      </section>

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
  }

  /** Actualiza textos sin re-renderizar todo el componente */
  private updateTexts(): void {
    const root = this.shadowRoot!;
    const h1 = root.querySelector('h1');
    if (h1) h1.innerHTML =
      `<span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>` +
      `<span class="hero-title-short"><span class="accent">$ </span>${t('hero.title.short')}</span>`;
    const subline = root.querySelector('.subline');
    if (subline) subline.innerHTML =
      `<span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>` +
      `<span class="subline-short"># ${t('hero.subtitle.short')}</span>`;
    const statusReactor = root.querySelector('#status-reactor');
    if (statusReactor) {
      const state = (statusReactor as HTMLElement).dataset.state ?? 'offline';
      statusReactor.textContent = t(state === 'online' ? 'status.reactor.online' : 'status.reactor.offline');
    }
    const statusModel = root.querySelector('#status-model');
    if (statusModel) {
      const state = (statusModel as HTMLElement).dataset.state ?? 'loading';
      const key = state === 'ready' ? 'hero.modelStatus'
                : state === 'lazy' ? 'status.model.lazy'
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
    const installBtnEl = root.querySelector('#install-btn') as HTMLButtonElement;
    if (installBtnEl) {
      installBtnEl.textContent = isAppInstalled() ? t('pwa.installed') : t('pwa.install');
      installBtnEl.setAttribute('aria-label', t('pwa.install'));
    }
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
    const cmdCancel = root.querySelector('#cmd-cancel');
    if (cmdCancel) cmdCancel.textContent = t('cmdbar.cancel');
    const cmdStateLabel = root.querySelector('#cmd-state-label') as HTMLElement | null;
    const cmdStateHost = root.querySelector('#cmd-state') as HTMLElement | null;
    if (cmdStateLabel && cmdStateHost) {
      const state = cmdStateHost.getAttribute('data-state') ?? 'running';
      const key = state === 'running' ? 'cmdbar.running'
                : state === 'ready' ? 'cmdbar.ready'
                : 'cmdbar.failed';
      cmdStateLabel.textContent = t(key);
    }
  }

  private getInstallGuide(): string {
    const ua = navigator.userAgent.toLowerCase();
    let steps: string;
    if (/firefox/i.test(ua)) {
      steps = t('pwa.guideFirefox');
    } else if (/iphone|ipad|ipod/i.test(ua)) {
      steps = t('pwa.guideSafari');
    } else {
      steps = t('pwa.guideGeneric');
    }
    return `<div class="guide-motivation">${t('pwa.guideMotivation')}</div>${steps}<br><button class="install-guide-close">${t('pwa.guideDismiss')}</button>`;
  }

  private setupEvents(): void {
    // Hoisted once so every addEventListener below can reuse it for
    // component-lifecycle cleanup via AbortSignal.
    const signal = this.abortController!.signal;

    // Listen for locale changes
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);

    // Cancel button lives in the command bar (#71). The same
    // ar:cancel-processing event is dispatched from there and caught at
    // the shadow-root level so legacy listeners (progress component,
    // tests) still work.
    const bubbleCancel = (): void => {
      this.dispatchEvent(new CustomEvent('ar:cancel-processing', { bubbles: true, composed: true }));
    };
    this.shadowRoot!.addEventListener('ar:cancel-processing', () => {
      if (this.processingAbortController && !this.processingAbortController.signal.aborted) {
        this.processingAbortController.abort('user cancelled');
      }
      if (this.batchMode !== 'off') {
        this.batchAborted = true;
      }
    }, { signal });

    const cmdCancel = this.shadowRoot!.querySelector('#cmd-cancel') as HTMLButtonElement | null;
    cmdCancel?.addEventListener('click', bubbleCancel, { signal });

    // #78 — inline error-stage actions in ar-progress. Retry reuses
    // the existing retryFromError() path; report opens a pre-filled
    // GitHub issue URL with browser + session hints; reload is
    // handled by ar-progress itself (location.reload).
    this.progress.addEventListener('ar:stage-retry', () => this.retryFromError(), { signal });
    this.progress.addEventListener('ar:stage-report', (ev) => {
      const stage = (ev as CustomEvent<{ stage: string }>).detail.stage;
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
    }, { signal });

    // #79 — quiet-mode toggle lives in the footer (light DOM).
    const quietBtn = document.getElementById('quiet-mode-toggle');
    quietBtn?.addEventListener('click', () => {
      this.setPlayfulMode(!this.isPlayful());
    }, { signal });
    // Initial label translation.
    this.syncQuietModeToggle();

    // Error modal wiring (#36).
    const retryBtn = this.shadowRoot!.querySelector('#error-modal-retry') as HTMLButtonElement | null;
    const dismissBtn = this.shadowRoot!.querySelector('#error-modal-dismiss') as HTMLButtonElement | null;
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

    // PWA install button - mobile only
    const installBtn = this.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
    const installGuide = this.shadowRoot!.querySelector('#install-guide') as HTMLDivElement;
    let hasNativePrompt = false;

    // If already installed, show the installed state
    if (isAppInstalled()) {
      installBtn.textContent = t('pwa.installed');
      installBtn.classList.add('visible');
      installBtn.disabled = true;
    }

    // Show install button when PWA native prompt is available (Chromium)
    this.boundPwaInstallableHandler = () => {
      hasNativePrompt = true;
      if (!isAppInstalled()) {
        installBtn.textContent = t('pwa.install');
        installBtn.classList.add('visible');
        installBtn.disabled = false;
      }
    };
    document.addEventListener('nukebg:pwa-installable', this.boundPwaInstallableHandler);

    // On mobile without native prompt, show install button after a delay
    // (Firefox, Safari - they can install but need manual steps)
    const isMobile = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (isMobile && !isAppInstalled()) {
      setTimeout(() => {
        if (!hasNativePrompt) {
          installBtn.textContent = t('pwa.install');
          installBtn.classList.add('visible');
          installBtn.disabled = false;
        }
      }, 2000);
    }

    installBtn.addEventListener('click', async () => {
      // If native prompt available (Chromium), use it
      if (hasNativePrompt) {
        const accepted = await installApp();
        if (accepted) {
          installBtn.textContent = t('pwa.installed');
          installBtn.disabled = true;
          installGuide.classList.remove('visible');
        }
        return;
      }
      // Otherwise show browser-specific instructions
      const guide = this.getInstallGuide();
      installGuide.innerHTML = guide;
      installGuide.classList.toggle('visible');
      const closeBtn = installGuide.querySelector('.install-guide-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => installGuide.classList.remove('visible'), { signal });
      }
    }, { signal });

    this.shadowRoot!.addEventListener('ar:image-loaded', async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.currentFileName = detail.file.name || 'image.png';

      // If currently processing, abort the in-flight pipeline and reset
      if (this.isProcessing) {
        this.processingAborted = true;
        this.isProcessing = false;
        this.enableWorkspaceButtons();
      }

      await this.processImage(detail.imageData, detail.originalImageData ?? detail.imageData, detail.file.size);
    }, { signal });

    this.shadowRoot!.addEventListener('ar:images-loaded', async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        images: Array<{
          file: File;
          imageData: ImageData;
          originalImageData: ImageData;
          originalWidth: number;
          originalHeight: number;
          wasDownsampled: boolean;
        }>;
      };
      if (this.isProcessing) {
        this.processingAborted = true;
        this.isProcessing = false;
        this.enableWorkspaceButtons();
      }
      await this.startBatch(detail.images);
    }, { signal });

    this.shadowRoot!.addEventListener('batch:item-click', (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; state: string };
      this.openBatchDetail(detail.id);
    }, { signal });

    this.shadowRoot!.addEventListener('batch:download-zip', async () => {
      await this.downloadBatchZip();
    }, { signal });

    this.shadowRoot!.addEventListener('batch:cancel', () => {
      this.resetToIdle();
    }, { signal });

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

    this.shadowRoot!.addEventListener('ar:process-another', () => {
      this.resetToIdle();
    }, { signal });

    // Disclaimer click - toggle limitations detail
    // Limitations now live inside <details id="status-limits"> — native
    // disclosure widget handles open/close. No click wiring needed.

    // Edit button - opens editor or discards edits
    this.shadowRoot!.querySelector('#edit-btn')?.addEventListener('click', async () => {
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
    }, { signal });



    // Editor cancel - discard edits, close editor
    this.shadowRoot!.addEventListener('ar:editor-cancel', () => {
      (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
      (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'block';
    }, { signal });

    // Editor done - update viewer and download with edited result
    this.shadowRoot!.addEventListener('ar:editor-done', async (e: Event) => {
      const rawEdited = (e as CustomEvent).detail.imageData as ImageData;
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
    }, { signal });

    // Advanced editor CTA toggle
    this.shadowRoot!.querySelector('#advanced-cta')?.addEventListener('click', () => {
      const adv = this.shadowRoot!.querySelector('#editor-advanced') as ArEditorAdvanced | null;
      const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
      if (!adv || !btn) return;
      const isOpen = adv.hasAttribute('active');
      if (isOpen) {
        adv.removeAttribute('active');
        btn.removeAttribute('data-active');
        return;
      }
      const current = this.lastResultImageData ?? this.currentImageData;
      const original = this.currentOriginalImageData ?? this.currentImageData;
      if (!current || !original) return;
      adv.setImage(current, original);
      adv.setAttribute('active', '');
      btn.setAttribute('data-active', 'true');
      adv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, { signal });

    // Advanced editor — cancel
    this.shadowRoot!.addEventListener('ar:advanced-cancel', () => {
      const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
      btn?.removeAttribute('data-active');
    }, { signal });

    // Advanced editor — done
    this.shadowRoot!.addEventListener('ar:advanced-done', async (e: Event) => {
      const detail = (e as CustomEvent<{ imageData: ImageData }>).detail;
      const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
      btn?.removeAttribute('data-active');

      // Same reasoning as the basic editor: skip topology cleanup so the
      // user's lasso crops / restores survive the refinement pass.
      const refined = await refineEdges(this.pipeline, detail.imageData, {
        skipTopologyCleanup: true,
      });
      const blob = await exportPng(refined);
      this.viewer.setResult(refined, blob);
      await this.download.setResult(refined, this.currentFileName, 0, blob);
      this.lastResultImageData = refined;
    }, { signal });
  }

  /**
   * Whether the UI is in "playful" mode — drives CRT flicker, smoke
   * overlay, H1 vibration, and the per-precision-mode color palette
   * swap. Default is on; users in quiet mode or with
   * `prefers-reduced-motion: reduce` get the calm green default.
   */
  private isPlayful(): boolean {
    return document.documentElement.dataset.playful !== 'false';
  }

  // Advanced CTA replaces the edit-btn when visible.
  private setAdvancedBtnVisible(show: boolean): void {
    const cta = this.shadowRoot?.querySelector('#advanced-cta') as HTMLElement | null;
    const editBtn = this.shadowRoot?.querySelector('#edit-btn') as HTMLElement | null;
    if (!cta) return;
    cta.style.display = show ? 'block' : 'none';
    if (editBtn) editBtn.style.display = 'none';
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

  private async processImage(imageData: ImageData, originalImageData: ImageData, fileSize: number): Promise<void> {
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
        }
      );
    } else {
      // Update the callback to point to current progress component
      this.pipeline.setStageCallback(
        (stage: PipelineStage, status: StageStatus, message?: string) => {
          this.progress.setStage(stage, status, message);
        }
      );
    }

    try {
      if (originalImageData.width !== imageData.width || originalImageData.height !== imageData.height) {
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

      const composed = composeAtOriginal({
        originalRgba: originalImageData.data,
        originalWidth: originalImageData.width,
        originalHeight: originalImageData.height,
        workingRgba: result.workingPixels,
        workingWidth: result.workingWidth,
        workingHeight: result.workingHeight,
        workingAlpha: result.workingAlpha,
        inpaintMask: result.watermarkMask,
      });
      // Drop RMBG's disconnected false-positive blobs (e.g. horizon bands,
      // misfired watermark fragments) for classes where the subject is one
      // body. Signatures and icons may legitimately have multiple components.
      // fillSubjectHoles then patches α=0 holes enclosed by the body (RMBG
      // false negatives on specular highlights). promoteSpeckleAlpha
      // additionally promotes semi-transparent specks surrounded by dense
      // opaque neighbors — same artefact class but partial-α instead of zero.
      const finalImageData =
        result.contentType === 'PHOTO' || result.contentType === 'ILLUSTRATION'
          ? promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(composed)))
          : composed;
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
      // Abort is an expected outcome when the user drops a new image
      // mid-process or cancels a batch. Swallow it silently; the new
      // run (if any) will clear the progress UI on its own.
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
        document.dispatchEvent(new CustomEvent('ar:nuke-success'));
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
      const kb = payload.sizeBytes > 0
        ? ` · ${this.formatBytes(payload.sizeBytes)}`
        : '';
      meta.textContent = ` · ${payload.width}×${payload.height}${kb}`;
    }
    this.updateCommandBarState(payload.state);
  }

  private updateCommandBarState(state: 'running' | 'ready' | 'failed'): void {
    const root = this.shadowRoot!;
    const stateEl = root.querySelector('#cmd-state') as HTMLElement | null;
    const label = root.querySelector('#cmd-state-label');
    const cancelBtn = root.querySelector('#cmd-cancel') as HTMLButtonElement | null;
    if (!stateEl || !label || !cancelBtn) return;
    stateEl.hidden = false;
    stateEl.setAttribute('data-state', state);
    const key = state === 'running' ? 'cmdbar.running'
              : state === 'ready' ? 'cmdbar.ready'
              : 'cmdbar.failed';
    label.textContent = t(key);
    cancelBtn.hidden = state !== 'running';
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
    const retryBtn = this.shadowRoot?.querySelector('#error-modal-retry') as HTMLButtonElement | null;
    if (!modal || !messageEl) return;
    messageEl.textContent = msg;
    const canRetry = !!(this.currentImageData && this.currentOriginalImageData);
    if (retryBtn) retryBtn.hidden = !canRetry;
    modal.hidden = false;
    // Shift focus to the primary action so keyboard users can act
    // without hunting for the dialog.
    queueMicrotask(() => {
      (canRetry ? retryBtn : (this.shadowRoot?.querySelector('#error-modal-dismiss') as HTMLElement | null))?.focus();
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
    this.processImage(
      this.currentImageData,
      this.currentOriginalImageData,
      this.currentFileSize,
    );
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
    this.batchMode = mode;
  }

  private async startBatch(images: Array<{
    file: File;
    imageData: ImageData;
    originalImageData: ImageData;
    originalWidth: number;
    originalHeight: number;
    wasDownsampled: boolean;
  }>): Promise<void> {
    this.batchAborted = false;
    this.batchItems = images.map((img, i) => ({
      id: `batch-${Date.now()}-${i}`,
      originalName: img.file.name || `image-${i + 1}.png`,
      file: img.file,
      imageData: img.imageData,
      originalImageData: img.originalImageData ?? img.imageData,
      state: 'pending',
      result: null,
      finalImageData: null,
      thumbnailUrl: this.makeThumbnail(img.originalImageData ?? img.imageData),
      stageHistory: [],
    }));

    // setBatchUiMode handles hero/workspace/dropzone visibility for grid mode.
    this.setBatchUiMode('grid');

    if (this.batchGrid) {
      this.batchGrid.setItems(this.batchItems);
      this.batchGrid.setCurrentIndex(0);
    }

    // Stage callback: drives the live progress console AND records the
    // event into the item being processed so we can replay the exact
    // sequence (running → done / skipped / error) if the user reopens
    // that item's detail later.
    const batchStageCallback = (stage: PipelineStage, status: StageStatus, message?: string): void => {
      this.progress.setStage(stage, status, message);
      const current = this.batchCurrentProcessingItem;
      if (current) current.stageHistory.push({ stage, status, message });
    };

    if (!this.pipeline) {
      this.pipeline = new PipelineOrchestrator(batchStageCallback);
    } else {
      this.pipeline.setStageCallback(batchStageCallback);
    }

    await this.runBatchQueue();
  }

  private async runBatchQueue(): Promise<void> {
    for (let i = 0; i < this.batchItems.length; i++) {
      if (this.batchAborted) return;
      const item = this.batchItems[i];
      if (item.state === 'done' || item.state === 'discarded') continue;
      if (this.batchGrid) this.batchGrid.setCurrentIndex(i);
      item.state = 'processing';
      // Fresh slate for this item: empty history, empty live console.
      item.stageHistory = [];
      this.progress.reset();
      this.progress.setRunning(true);
      this.batchCurrentProcessingItem = item;
      if (this.batchGrid) this.batchGrid.updateItem(item.id, 'processing');
      // One signal per batch item so cancelling the batch aborts the
      // in-flight one promptly without waiting for the current stage.
      this.processingAbortController = new AbortController();
      try {
        const result = await this.pipeline!.process(
          item.imageData,
          ArApp.MODEL_ID,
          'high-power',
          this.processingAbortController.signal,
        );
        if (this.batchAborted) return;
        const composed = composeAtOriginal({
          originalRgba: item.originalImageData.data,
          originalWidth: item.originalImageData.width,
          originalHeight: item.originalImageData.height,
          workingRgba: result.workingPixels,
          workingWidth: result.workingWidth,
          workingHeight: result.workingHeight,
          workingAlpha: result.workingAlpha,
          inpaintMask: result.watermarkMask,
        });
        const finalImageData =
          result.contentType === 'PHOTO' || result.contentType === 'ILLUSTRATION'
            ? promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(composed)))
            : composed;
        item.result = result;
        item.finalImageData = finalImageData;
        item.thumbnailUrl = this.makeThumbnail(finalImageData);
        item.state = 'done';
        if (this.batchGrid) this.batchGrid.updateItem(item.id, 'done', item.thumbnailUrl);
        // If the user is currently watching this item's live detail view,
        // swap it to the done view so they see the result without going back.
        if (this.batchDetailId === item.id) {
          await this.openBatchDetail(item.id);
        }
      } catch (err) {
        // Abort during batch = user cancelled. Don't mark the item as
        // failed; the outer batchAborted check will return on next tick.
        if (err instanceof PipelineAbortError || this.batchAborted) {
          this.progress.setRunning(false);
          return;
        }
        item.errorMessage = err instanceof Error ? err.message : String(err);
        item.state = 'failed';
        if (this.batchGrid) this.batchGrid.updateItem(item.id, 'failed');
        if (this.batchDetailId === item.id) {
          await this.openBatchDetail(item.id);
        }
      }
    }
    this.progress.setRunning(false);
    this.batchCurrentProcessingItem = null;
  }

  /** Replay a finished item's captured stage events into the shared
   * progress console. Resets first so no stale state from the previous
   * item leaks through, then reapplies each snapshot in order. */
  private replayStageHistory(history: StageSnapshot[]): void {
    this.progress.reset();
    for (const snap of history) {
      this.progress.setStage(snap.stage, snap.status, snap.message);
    }
  }

  private async openBatchDetail(id: string): Promise<void> {
    const item = this.batchItems.find(i => i.id === id);
    if (!item) return;
    this.batchDetailId = id;

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
        this.replayStageHistory(item.stageHistory);
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
      this.replayStageHistory(item.stageHistory);
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
    this.batchDetailId = null;
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
    this.setBatchUiMode('grid');
  }

  private async retryBatchItem(): Promise<void> {
    if (!this.batchDetailId) return;
    const item = this.batchItems.find(i => i.id === this.batchDetailId);
    if (!item) return;
    item.state = 'pending';
    item.errorMessage = undefined;
    item.stageHistory = [];
    if (this.batchGrid) this.batchGrid.updateItem(item.id, 'pending');
    this.closeBatchDetail();
    await this.runBatchQueue();
  }

  private discardBatchItem(): void {
    if (!this.batchDetailId) return;
    const item = this.batchItems.find(i => i.id === this.batchDetailId);
    if (!item) return;
    item.state = 'discarded';
    if (this.batchGrid) this.batchGrid.updateItem(item.id, 'discarded');
    this.closeBatchDetail();
  }

  private async downloadBatchZip(): Promise<void> {
    const done = this.batchItems.filter(i => i.state === 'done' && i.result);
    if (done.length === 0) return;
    const files = await Promise.all(
      done.map(async (item, idx) => ({
        name: safeZipEntryName(idx + 1, done.length, item.originalName),
        blob: await exportPng(item.finalImageData ?? item.result!.imageData),
      })),
    );
    const zip = await createZip(files);
    downloadBlob(zip, `nukebg-batch-${Date.now()}.zip`);
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

    if (this.batchMode !== 'off') {
      this.batchAborted = true;
      // Stop the in-flight pipeline run too — otherwise workers keep
      // processing the current item until its natural stage boundary.
      this.processingAbortController?.abort('batch aborted');
      this.batchItems = [];
      this.batchDetailId = null;
      this.batchMode = 'off';
    }
    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
