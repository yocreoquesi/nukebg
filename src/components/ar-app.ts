import { PipelineOrchestrator } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import type { PrecisionMode } from '../pipeline/constants';
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
import { composeAtOriginal } from '../utils/final-composite';

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
  private selectedPrecision: PrecisionMode = 'normal';
  private lastResultImageData: ImageData | null = null;
  private crtFlickerTimers: number[] = [];
  private isProcessing = false;
  private processingAborted = false;
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
    this.render();
    this.setupComponents();
    this.setupEvents();
    this.preloadModel();
  }

  /** Pre-load model + warmup as soon as page opens */
  private preloadModel(): void {
    const statusEl = () => this.shadowRoot?.querySelector('#model-status');

    this.pipeline = new PipelineOrchestrator(
      (_stage: PipelineStage, _status: StageStatus, message?: string) => {
        const el = statusEl();
        if (el && message) el.textContent = message;
      }
    );

    const el = statusEl();
    if (el) el.textContent = 'Loading AI model...';

    // Dropzone starts disabled until model is ready
    this.dropzone.setEnabled(false);

    this.pipeline.preloadModel(ArApp.MODEL_ID).then(() => {
      const s = statusEl();
      if (s) {
        s.textContent = '> reactor online. Ready to nuke.';
        s.classList.add('ready');
      }
      this.dropzone.setEnabled(true);
    }).catch(() => {
      const s = statusEl();
      if (s) s.textContent = '> model loads on first image';
      // Enable dropzone anyway so user can still try
      this.dropzone.setEnabled(true);
    });
  }

  disconnectedCallback(): void {
    this.crtFlickerTimers.forEach(id => clearTimeout(id));
    this.crtFlickerTimers = [];
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
          --terminal-color-override: initial;
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
          text-shadow: 0 0 10px rgba(0, 255, 65, 0.4);
        }
        h1::before {
          content: '$ ';
          color: var(--color-text-tertiary, #008830);
        }
        h1 .accent {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 12px rgba(0, 255, 65, 0.5);
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
        .subline::before {
          content: '# ';
          color: var(--color-text-tertiary, #008830);
        }
        .model-status {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #008830);
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
          color: var(--color-text-tertiary, #008830);
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
          border: 1px solid #1a3a1a;
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
          border: 1px solid #1a3a1a;
          color: var(--color-text-tertiary, #008830);
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
          background: rgba(0, 255, 65, 0.08);
          box-shadow: 0 0 8px rgba(0, 255, 65, 0.3);
        }
        .batch-discard-btn {
          border-color: #3a1a1a;
          color: #ff3131;
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
        .features {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0;
          padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
          max-width: 1200px;
          margin: 0 auto;
        }
        .feature-card {
          background: transparent;
          border: none;
          border-bottom: 1px solid #0d1a0d;
          border-radius: 0;
          padding: var(--space-3, 0.75rem) 0;
          transition: border-color 0.3s ease;
        }
        .feature-card:hover {
          border-color: #1a3a1a;
          box-shadow: none;
          transform: none;
        }
        .feature-card:hover .feature-icon {
          filter: drop-shadow(0 0 4px rgba(0, 255, 65, 0.6));
        }
        .feature-icon {
          font-size: 16px;
          display: inline;
          margin-right: 8px;
          margin-bottom: 0;
          transition: filter 0.3s ease;
        }
        .feature-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-sm, 0.875rem);
          font-weight: var(--font-semibold, 600);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-tertiary, #008830);
          margin-bottom: var(--space-2, 0.5rem);
        }
        .feature-title::before {
          content: '> ';
          color: var(--color-text-tertiary, #008830);
        }
        .feature-desc {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
          line-height: 1.5;
        }
        .features-disclaimer {
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
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
          color: var(--color-text-tertiary, #008830);
          text-decoration: line-through;
          opacity: 0.7;
        }
        .limitations-detail {
          display: none;
          text-align: left;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--color-text-tertiary, #008830);
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
        #precision-slider {
          width: 80px;
          accent-color: var(--color-accent-primary, #00ff41);
          cursor: pointer;
        }
        .reactor-label {
          font-size: 10px;
          color: var(--color-text-tertiary, #008830);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-family: 'JetBrains Mono', monospace;
        }
        .precision-label {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-accent-primary, #00ff41);
          min-width: 90px;
          text-align: center;
          transition: color 0.3s ease;
        }
        .reactor-support {
          display: none;
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
          margin-top: var(--space-2, 0.5rem);
          padding: 0 var(--space-4, 1rem);
        }
        .reactor-support a {
          color: var(--color-accent-primary, #00ff41);
          text-decoration: none;
        }
        .reactor-support a:hover {
          text-decoration: underline;
        }
        .reactor-support.visible {
          display: block;
        }
        .precision-marquee {
          display: block;
          overflow: hidden;
          white-space: nowrap;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 4px 0;
          margin-top: var(--space-1, 0.25rem);
          min-height: 24px;
          position: relative;
          color: var(--color-text-tertiary, #008830);
        }
        .precision-marquee span {
          display: inline-block;
          animation: marquee-scroll 20s linear infinite;
        }
        @keyframes marquee-scroll {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .precision-marquee span { animation: none; }
          .nuke-vibrate * { animation: none !important; }
          .smoke-effect { display: none !important; }
        }

        /* === Full Nuke vibration effect === */
        @keyframes nuke-shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-2px, 1px); }
          20% { transform: translate(2px, -1px); }
          30% { transform: translate(-1px, 2px); }
          40% { transform: translate(1px, -2px); }
          50% { transform: translate(-2px, -1px); }
          60% { transform: translate(2px, 1px); }
          70% { transform: translate(1px, 2px); }
          80% { transform: translate(-1px, -1px); }
          90% { transform: translate(2px, -2px); }
        }
        :host(.nuke-vibrate) h1,
        :host(.nuke-vibrate) .subline,
        :host(.nuke-vibrate) .feature-title {
          animation: nuke-shake 0.4s ease-in-out 3;
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
          border: 1px solid #1a3a1a;
          border-radius: 0;
          padding: var(--space-3, 0.75rem);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .edit-btn:hover {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 10px rgba(0, 255, 65, 0.1);
        }
        /* === Color override for extreme precision levels === */
        :host(.precision-override) h1,
        :host(.precision-override) h1 .accent {
          color: var(--terminal-color-override, #00ff41);
          text-shadow: none;
        }
        :host(.precision-override) h1::before,
        :host(.precision-override) .subline::before,
        :host(.precision-override) .feature-title::before {
          color: var(--terminal-color-override, #008830);
        }
        :host(.precision-override) .subline,
        :host(.precision-override) .model-status,
        :host(.precision-override) .features-disclaimer {
          color: var(--terminal-color-override, #00dd44);
        }
        :host(.precision-override) .feature-desc {
          color: var(--terminal-color-override, #00dd44);
          opacity: 0.7;
        }
        :host(.precision-override) .feature-title,
        :host(.precision-override) .precision-label,
        :host(.precision-override) .terminal-prefix,
        :host(.precision-override) .feature-icon {
          color: var(--terminal-color-override, #00ff41);
        }
        :host(.precision-override) .reactor-label,
        :host(.precision-override) .reactor-support {
          color: var(--terminal-color-override, #008830);
        }
        :host(.precision-override) .reactor-support a {
          color: var(--terminal-color-override, #00ff41);
        }
        :host(.precision-override) .feature-sep {
          color: var(--terminal-color-override, #008830);
        }
        :host(.precision-override) .features-disclaimer a {
          color: var(--terminal-color-override, #00ff41);
        }
        :host(.precision-override) .features-disclaimer s {
          color: var(--terminal-color-override, #008830);
        }
        :host(.precision-override) .edit-btn {
          color: var(--terminal-color-override, #00dd44);
          border-color: var(--terminal-color-override, #1a3a1a);
        }
        :host(.precision-override) .model-status::before {
          color: var(--terminal-color-override, #008830);
        }
        :host(.precision-override) #precision-slider,
        :host(.precision-override) #precision-slider-ws {
          accent-color: var(--terminal-color-override, #00ff41);
        }

        /* === CRT Flicker effect for feature cards === */
        .feature-card .feature-title,
        .feature-card .feature-desc,
        .feature-card .feature-icon {
          transition: opacity 0.05s ease;
        }
        .feature-card.crt-flicker .feature-title,
        .feature-card.crt-flicker .feature-desc,
        .feature-card.crt-flicker .feature-icon {
          opacity: 0.05;
        }
        @media (prefers-reduced-motion: reduce) {
          .feature-card.crt-flicker .feature-title,
          .feature-card.crt-flicker .feature-desc,
          .feature-card.crt-flicker .feature-icon {
            opacity: 1;
          }
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
          .feature-card {
            padding: var(--space-2, 0.5rem) 0;
          }
          .feature-title {
            font-size: var(--text-xs, 0.75rem);
          }
          .feature-desc {
            font-size: 12px;
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
          .feature-card, .edit-btn {
            transition: none !important;
          }
        }

        /* === Layout variants via data-card-layout === */

        /* Hidden by default - shown per-layout */
        .terminal-prefix,
        .feature-sep {
          display: none;
        }

        /* ──────────────────────────────────────────
           LAYOUT A: Terminal list
           One-liner per feature, no cards, no icons
        ────────────────────────────────────────── */
        :host .features[data-card-layout="A"] {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
        }
        :host .features[data-card-layout="A"] .feature-card {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          background: transparent;
          border: none;
          border-bottom: none;
          padding: var(--space-1, 0.25rem) 0;
        }
        :host .features[data-card-layout="A"] .feature-card:hover {
          border-color: transparent;
        }
        :host .features[data-card-layout="A"] .terminal-prefix {
          display: inline;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
          margin-right: 6px;
          flex-shrink: 0;
        }
        :host .features[data-card-layout="A"] .feature-icon {
          display: none;
        }
        :host .features[data-card-layout="A"] .feature-title {
          display: inline;
          font-size: 12px;
          margin-bottom: 0;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        :host .features[data-card-layout="A"] .feature-title::before {
          content: none;
        }
        :host .features[data-card-layout="A"] .feature-sep {
          display: inline;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
        }
        :host .features[data-card-layout="A"] .feature-desc {
          display: inline;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }

        /* Layout A mobile */
        @media (max-width: 480px) {
          :host .features[data-card-layout="A"] {
            padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          }
          :host .features[data-card-layout="A"] .feature-title,
          :host .features[data-card-layout="A"] .feature-sep,
          :host .features[data-card-layout="A"] .feature-desc,
          :host .features[data-card-layout="A"] .terminal-prefix {
            font-size: 12px;
          }
        }

        /* ──────────────────────────────────────────
           LAYOUT B: Inline cards
           Icon left, title + desc stacked right, vertical list
        ────────────────────────────────────────── */
        :host .features[data-card-layout="B"] {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
        }
        :host .features[data-card-layout="B"] .feature-card {
          display: grid;
          grid-template-columns: 24px 1fr;
          grid-template-rows: auto auto;
          column-gap: var(--space-2, 0.5rem);
          row-gap: 0;
          background: transparent;
          border: none;
          border-left: 1px solid transparent;
          padding: var(--space-2, 0.5rem) var(--space-2, 0.5rem);
          transition: border-color 0.3s ease;
        }
        :host .features[data-card-layout="B"] .feature-card:hover {
          border-left-color: #1a3a1a;
        }
        :host .features[data-card-layout="B"] .terminal-prefix {
          display: none;
        }
        :host .features[data-card-layout="B"] .feature-sep {
          display: none;
        }
        :host .features[data-card-layout="B"] .feature-icon {
          grid-row: 1 / 3;
          grid-column: 1;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          font-size: 14px;
          margin: 0;
          padding-top: 2px;
        }
        :host .features[data-card-layout="B"] .feature-title {
          grid-column: 2;
          grid-row: 1;
          font-size: var(--text-sm, 0.875rem);
          margin-bottom: 0;
        }
        :host .features[data-card-layout="B"] .feature-title::before {
          content: none;
        }
        :host .features[data-card-layout="B"] .feature-desc {
          grid-column: 2;
          grid-row: 2;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
          line-height: 1.4;
        }

        /* Layout B mobile */
        @media (max-width: 480px) {
          :host .features[data-card-layout="B"] {
            padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          }
          :host .features[data-card-layout="B"] .feature-title {
            font-size: var(--text-xs, 0.75rem);
          }
          :host .features[data-card-layout="B"] .feature-desc {
            font-size: 12px;
          }
        }

        /* ──────────────────────────────────────────
           LAYOUT C: Compact grid
           3 columns, icon+title inline, minimal padding
        ────────────────────────────────────────── */
        :host .features[data-card-layout="C"] {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-2, 0.5rem);
          padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
        }
        :host .features[data-card-layout="C"] .feature-card {
          background: transparent;
          border: 1px solid transparent;
          border-bottom: none;
          padding: var(--space-2, 0.5rem);
          transition: border-color 0.3s ease;
        }
        :host .features[data-card-layout="C"] .feature-card:hover {
          border-color: #1a3a1a;
        }
        :host .features[data-card-layout="C"] .terminal-prefix {
          display: none;
        }
        :host .features[data-card-layout="C"] .feature-sep {
          display: none;
        }
        :host .features[data-card-layout="C"] .feature-icon {
          display: inline;
          font-size: 14px;
          margin-right: 6px;
        }
        :host .features[data-card-layout="C"] .feature-title {
          display: inline;
          font-size: var(--text-sm, 0.875rem);
          margin-bottom: 0;
        }
        :host .features[data-card-layout="C"] .feature-title::before {
          content: none;
        }
        :host .features[data-card-layout="C"] .feature-desc {
          display: block;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
          line-height: 1.4;
          margin-top: var(--space-1, 0.25rem);
        }

        /* Layout C mobile - stack to 1 column */
        @media (max-width: 480px) {
          :host .features[data-card-layout="C"] {
            grid-template-columns: 1fr;
            padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          }
          :host .features[data-card-layout="C"] .feature-title {
            font-size: var(--text-xs, 0.75rem);
          }
          :host .features[data-card-layout="C"] .feature-desc {
            font-size: 12px;
          }
        }
        /* Layout C tablet - 2 columns */
        @media (min-width: 481px) and (max-width: 768px) {
          :host .features[data-card-layout="C"] {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        /* === CRT flicker for all layouts === */
        .feature-card.crt-flicker .terminal-prefix,
        .feature-card.crt-flicker .feature-sep {
          opacity: 0.3;
        }
        @media (prefers-reduced-motion: reduce) {
          .feature-card.crt-flicker .terminal-prefix,
          .feature-card.crt-flicker .feature-sep {
            opacity: 1;
          }
        }
      </style>

      <section class="hero" id="hero">
        <h1><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</h1>
        <p class="subline">
          ${t('hero.subtitle').replace(/\n/g, ' ')}
        </p>
        <div class="hero-controls">
          <div class="ws-precision">
            <span class="reactor-label">Reactor Power</span>
            <input type="range" id="precision-slider" min="0" max="3" value="1" step="1" aria-label="Reactor power level">
            <span class="precision-label" id="precision-label">Normal</span>
          </div>
          <ar-model-lab id="model-lab-hero"></ar-model-lab>
        </div>
        <ar-dropzone></ar-dropzone>
        <ar-batch-grid id="batch-grid" style="display:none"></ar-batch-grid>
        <p class="model-status" id="model-status">${t('hero.modelStatus')}</p>
        <button class="install-btn" id="install-btn" aria-label="${t('pwa.install')}">${isAppInstalled() ? t('pwa.installed') : t('pwa.install')}</button>
        <div class="install-guide" id="install-guide"></div>
        <div class="precision-marquee" id="precision-marquee"><span>☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢</span></div>
        <div class="smoke-effect" id="smoke-effect"></div>
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
          <ar-viewer></ar-viewer>
          <ar-progress></ar-progress>
          <div class="ws-controls">
            <div class="ws-slider-fixed">
              <span class="reactor-label">Reactor Power</span>
              <input type="range" id="precision-slider-ws" min="0" max="3" value="1" step="1" aria-label="Reactor power level">
              <span class="precision-label" id="precision-label-ws">Normal</span>
            </div>
            <ar-model-lab id="model-lab-ws"></ar-model-lab>
          </div>
          <div class="precision-marquee" id="precision-marquee-ws"><span>☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢</span></div>
          <ar-download></ar-download>
          <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
          </div>
        </div>
      </section>

      <section class="features" aria-label="Key features" data-card-layout="A" style="display:none">
        <h2 class="sr-only">${t('features.srTitle')}</h2>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#129504;</div>
          <h3 class="feature-title">${t('features.bgRemoval.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> | </span>
          <p class="feature-desc">
            ${t('features.bgRemoval.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#128274;</div>
          <h3 class="feature-title">${t('features.aiArtifacts.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> | </span>
          <p class="feature-desc">
            ${t('features.aiArtifacts.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#9762;</div>
          <h3 class="feature-title">${t('features.private.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> | </span>
          <p class="feature-desc">
            ${t('features.private.desc')}
          </p>
        </article>
        <p class="features-disclaimer" id="features-disclaimer">${t('features.disclaimer')}</p>
        <div class="limitations-detail" id="limitations-detail">${t('features.limitations')}</div>
        <p class="reactor-support" id="reactor-support"></p>
      </section>
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
    if (h1) h1.innerHTML = `<span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}`;
    const subline = root.querySelector('.subline');
    if (subline) subline.textContent = t('hero.subtitle').replace(/\n/g, ' ');
    const modelStatus = root.querySelector('#model-status');
    if (modelStatus) modelStatus.textContent = t('hero.modelStatus');
    const editBtn = root.querySelector('#edit-btn');
    if (editBtn) editBtn.textContent = this.preEditResult ? t('edit.discard') : t('edit.btn');
    const srTitle = root.querySelector('.features .sr-only');
    if (srTitle) srTitle.textContent = t('features.srTitle');
    const featureCards = root.querySelectorAll('.feature-card');
    const featureKeys = ['features.bgRemoval', 'features.aiArtifacts', 'features.private'];
    featureCards.forEach((card, i) => {
      const titleEl = card.querySelector('.feature-title');
      const descEl = card.querySelector('.feature-desc');
      if (titleEl && featureKeys[i]) titleEl.textContent = t(`${featureKeys[i]}.title`);
      if (descEl && featureKeys[i]) descEl.textContent = t(`${featureKeys[i]}.desc`);
    });
    const disclaimer = root.querySelector('#features-disclaimer');
    if (disclaimer) disclaimer.innerHTML = t('features.disclaimer');
    const limDetail = root.querySelector('#limitations-detail');
    if (limDetail) limDetail.innerHTML = t('features.limitations');
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
    // Listen for locale changes
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);

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

    const signal = this.abortController!.signal;

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
    const retryBtn = this.shadowRoot!.querySelector('#batch-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.retryBatchItem(), { signal });
    }
    const discardBtn = this.shadowRoot!.querySelector('#batch-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => this.discardBatchItem(), { signal });
    }

    this.shadowRoot!.addEventListener('ar:process-another', () => {
      this.resetToIdle();
    }, { signal });

    // Precision slider - 4 positions with visual effects at extremes
    const precisionKeys = ['low-power', 'normal', 'high-power', 'full-nuke'] as const;
    const precisionLabels = ['Low Power', 'Normal', 'High Power', 'FULL NUKE'];
    this.shadowRoot!.querySelector('#precision-slider')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      this.selectedPrecision = precisionKeys[val];
      const label = this.shadowRoot!.querySelector('#precision-label');
      if (label) label.textContent = precisionLabels[val];
      // Sync workspace slider
      const wsSlider = this.shadowRoot!.querySelector('#precision-slider-ws') as HTMLInputElement;
      if (wsSlider) wsSlider.value = String(val);
      const wsLabel = this.shadowRoot!.querySelector('#precision-label-ws');
      if (wsLabel) wsLabel.textContent = precisionLabels[val];

      const marquee = this.shadowRoot!.querySelector('#precision-marquee') as HTMLElement;
      const marqueeWs = this.shadowRoot!.querySelector('#precision-marquee-ws') as HTMLElement;
      const smoke = document.getElementById('smoke-overlay');
      const reactorSupport = this.shadowRoot!.querySelector('#reactor-support') as HTMLElement;

      // Ko-fi messages per power mode (not shown in Normal)
      const supportMessages: Record<string, Record<number, string>> = {
        en: { 0: 'The reactor is running cold. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Feed it on Ko-fi</a> to keep it alive.', 2: 'High power consumes more fuel. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Refuel on Ko-fi</a>.', 3: 'FULL NUKE MODE drains the core. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Prevent meltdown on Ko-fi</a>.' },
        es: { 0: 'El reactor va fr\u00EDo. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Al\u00EDmentalo en Ko-fi</a> para mantenerlo vivo.', 2: 'Alta potencia consume m\u00E1s combustible. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Recarga en Ko-fi</a>.', 3: 'MODO NUKE TOTAL agota el n\u00FAcleo. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Evita el colapso en Ko-fi</a>.' },
        fr: { 0: 'Le r\u00E9acteur tourne \u00E0 froid. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Alimente-le sur Ko-fi</a>.', 2: 'Haute puissance consomme plus. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Ravitaille sur Ko-fi</a>.', 3: 'MODE NUKE TOTAL \u00E9puise le noyau. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">\u00C9vite la fusion sur Ko-fi</a>.' },
        de: { 0: 'Der Reaktor l\u00E4uft kalt. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">F\u00FCttere ihn auf Ko-fi</a>.', 2: 'Hohe Leistung braucht mehr Treibstoff. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Nachtanken auf Ko-fi</a>.', 3: 'VOLLE NUKE-KRAFT leert den Kern. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Kernschmelze verhindern auf Ko-fi</a>.' },
        pt: { 0: 'O reator t\u00E1 frio. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Alimenta ele no Ko-fi</a>.', 2: 'Alta pot\u00EAncia consome mais combust\u00EDvel. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Reabastece no Ko-fi</a>.', 3: 'MODO NUKE TOTAL esgota o n\u00FAcleo. <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">Evita o colapso no Ko-fi</a>.' },
        zh: { 0: '\u53CD\u5E94\u5806\u8FD0\u884C\u4F4E\u6E29\u3002<a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">\u5728 Ko-fi \u4E0A\u7ED9\u5B83\u52A0\u71C3\u6599</a>\u3002', 2: '\u9AD8\u529F\u7387\u6D88\u8017\u66F4\u591A\u71C3\u6599\u3002<a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">\u5728 Ko-fi \u4E0A\u8865\u5145\u80FD\u91CF</a>\u3002', 3: '\u5168\u529B\u6838\u7206\u6A21\u5F0F\u6D88\u8017\u6838\u5FC3\u3002<a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener">\u5728 Ko-fi \u4E0A\u9632\u6B62\u7194\u6BC1</a>\u3002' },
      };

      const updateReactorSupport = (modeVal: number): void => {
        if (!reactorSupport) return;
        if (modeVal === 1) {
          reactorSupport.classList.remove('visible');
          return;
        }
        const lang = document.documentElement.lang || 'en';
        const msgs = supportMessages[lang] || supportMessages['en'];
        const msg = msgs[modeVal];
        if (msg) {
          reactorSupport.innerHTML = msg;
          reactorSupport.classList.add('visible');
        }
      };

      // Helper to update both marquees (hero + workspace)
      const updateMarquees = (color: string, html: string): void => {
        [marquee, marqueeWs].forEach(m => {
          if (m) {
            m.style.color = color;
            m.innerHTML = html;
          }
        });
      };

      if (val === 3) {
        // Full Nuke - red override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#cc3333');
        document.documentElement.style.setProperty('--color-text-primary', '#cc3333');
        document.documentElement.style.setProperty('--color-text-secondary', '#aa2222');
        document.documentElement.style.setProperty('--color-text-tertiary', '#882222');
        document.documentElement.style.setProperty('--color-accent-primary', '#cc3333');
        document.documentElement.style.setProperty('--color-accent-glow', 'rgba(204,51,51,0.35)');
        this.classList.add('precision-override');
        // Stop CRT flicker in Full Nuke
        this.stopCrtFlicker();
        updateMarquees('#cc3333', '<span>\u26A0 MAXIMUM POWER | Your images never leave your device | 100% local processing | nukebg.app \u26A0 MAXIMUM POWER | Your images never leave your device | 100% local processing | nukebg.app \u26A0</span>');
        console.log('%c[NukeBG] Mode: FULL NUKE', 'color: #cc3333; font-family: monospace;');
        updateReactorSupport(3);

        // Vibration + smoke: trigger once per activation, after random 1-5s delay
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reducedMotion) {
          const delay = 1000 + Math.random() * 4000;
          setTimeout(() => {
            // Only fire if still in Full Nuke mode
            if (this.selectedPrecision !== 'full-nuke') return;
            // Vibrate text
            this.classList.add('nuke-vibrate');
            setTimeout(() => this.classList.remove('nuke-vibrate'), 1200);
            // Smoke effect
            if (smoke) {
              smoke.classList.remove('active');
              void smoke.offsetWidth; // force reflow to restart animation
              smoke.classList.add('active');
              setTimeout(() => smoke.classList.remove('active'), 5000);
            }
          }, delay);
        }
        // Show features in Full Nuke
        const featuresFN = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresFN) featuresFN.style.display = '';
      } else if (val === 2) {
        // High Power - orange/amber override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#ff8c00');
        document.documentElement.style.setProperty('--color-text-primary', '#ff8c00');
        document.documentElement.style.setProperty('--color-text-secondary', '#cc7000');
        document.documentElement.style.setProperty('--color-text-tertiary', '#995300');
        document.documentElement.style.setProperty('--color-accent-primary', '#ff8c00');
        document.documentElement.style.setProperty('--color-accent-glow', 'rgba(255,140,0,0.35)');
        this.classList.add('precision-override');
        // Stop CRT flicker in High Power
        this.stopCrtFlicker();
        updateMarquees('#ff8c00', '<span>\u26A1 HIGH POWER | Zero uploads, zero tracking | Free and open source | nukebg.app \u26A1 HIGH POWER | Zero uploads, zero tracking | Free and open source | nukebg.app \u26A1</span>');
        console.log('%c[NukeBG] Mode: HIGH POWER', 'color: #ff8c00; font-family: monospace;');
        updateReactorSupport(2);
        // Hide smoke in High Power
        if (smoke) smoke.classList.remove('active');
        // Show features in non-Normal modes
        const featuresHP = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresHP) featuresHP.style.display = '';
      } else if (val === 0) {
        // Low Power - yellow override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#b8a500');
        document.documentElement.style.setProperty('--color-text-primary', '#b8a500');
        document.documentElement.style.setProperty('--color-text-secondary', '#8a7d00');
        document.documentElement.style.setProperty('--color-text-tertiary', '#6b5e00');
        document.documentElement.style.setProperty('--color-accent-primary', '#b8a500');
        document.documentElement.style.setProperty('--color-accent-glow', 'rgba(184,165,0,0.35)');
        this.classList.add('precision-override');
        // Start CRT flicker only in Low Power
        this.startCrtFlicker();
        // Show features in non-Normal modes
        const featuresLP = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresLP) featuresLP.style.display = '';
        updateMarquees('#b8a500', '<span>\u26A1 LOW POWER | Works offline after first visit | No account needed | nukebg.app \u26A1 LOW POWER | Works offline after first visit | No account needed | nukebg.app \u26A1</span>');
        console.log('%c[NukeBG] Mode: LOW POWER', 'color: #b8a500; font-family: monospace;');
        updateReactorSupport(0);
        // Hide smoke in Low Power
        if (smoke) smoke.classList.remove('active');
      } else {
        // Normal (val === 1) - restore all overrides
        document.documentElement.style.removeProperty('--terminal-color-override');
        document.documentElement.style.removeProperty('--color-text-primary');
        document.documentElement.style.removeProperty('--color-text-secondary');
        document.documentElement.style.removeProperty('--color-text-tertiary');
        document.documentElement.style.removeProperty('--color-accent-primary');
        document.documentElement.style.removeProperty('--color-accent-glow');
        this.classList.remove('precision-override');
        // Stop CRT flicker in normal modes
        this.stopCrtFlicker();
        // Subtle green marquee for normal mode
        updateMarquees('#008830', '<span>☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢ NUKEBG | DROP. NUKE. DOWNLOAD. | Your images never leave your device | nukebg.app ☢</span>');
        console.log('%c[NukeBG] Mode: NORMAL', 'color: #00ff41; font-family: monospace;');
        updateReactorSupport(1);
        // Hide smoke in normal modes
        if (smoke) smoke.classList.remove('active');
        // Hide features in Normal mode - clean minimal view
        const featuresSection = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresSection) featuresSection.style.display = 'none';
      }
    }, { signal });

    // Workspace precision slider - syncs with hero slider
    this.shadowRoot!.querySelector('#precision-slider-ws')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      // Sync hero slider and visual effects
      const heroSlider = this.shadowRoot!.querySelector('#precision-slider') as HTMLInputElement;
      if (heroSlider) heroSlider.value = String(val);
      heroSlider?.dispatchEvent(new Event('input'));
      const wsLabel = this.shadowRoot!.querySelector('#precision-label-ws');
      if (wsLabel) wsLabel.textContent = precisionLabels[val];
      // No auto-reprocess - user must click Reprocess button
    }, { signal });

    // Disclaimer click - toggle limitations detail
    this.shadowRoot!.querySelector('#features-disclaimer')?.addEventListener('click', () => {
      const detail = this.shadowRoot!.querySelector('#limitations-detail');
      if (detail) detail.classList.toggle('visible');
    }, { signal });

    // Edit button - opens editor or discards edits
    this.shadowRoot!.querySelector('#edit-btn')?.addEventListener('click', async () => {
      if (!this.lastResultImageData) return;

      if (this.preEditResult) {
        // Discard mode: restore pre-edit result, cache edit for instant re-apply
        this.cachedEditResult = this.lastResultImageData;
        this.lastResultImageData = this.preEditResult;
        this.preEditResult = null;

        const { exportPng } = await import('../utils/image-io');
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
      const editedData = (e as CustomEvent).detail.imageData as ImageData;
      const { exportPng } = await import('../utils/image-io');
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

  }

  private startCrtFlicker(): void {
    if (this.crtFlickerTimers.length > 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const cards = this.shadowRoot!.querySelectorAll('.feature-card');
    cards.forEach((card) => {
      const scheduleFlicker = (): void => {
        const delay = 2000 + Math.random() * 6000; // 2s-8s random
        const timerId = window.setTimeout(() => {
          // Random: 70% quick flicker, 30% longer blackout
          const isBlackout = Math.random() < 0.3;
          const duration = isBlackout
            ? 300 + Math.random() * 500  // 300-800ms blackout
            : 80 + Math.random() * 80;   // 80-160ms flicker

          card.classList.add('crt-flicker');
          window.setTimeout(() => {
            card.classList.remove('crt-flicker');
            scheduleFlicker(); // schedule next one
          }, duration);
        }, delay);
        this.crtFlickerTimers.push(timerId);
      };
      scheduleFlicker();
    });
  }

  private stopCrtFlicker(): void {
    this.crtFlickerTimers.forEach(id => clearTimeout(id));
    this.crtFlickerTimers = [];
    const allCards = this.shadowRoot!.querySelectorAll('.feature-card');
    allCards.forEach(c => c.classList.remove('crt-flicker'));
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

      const result = await this.pipeline.process(imageData, ArApp.MODEL_ID, this.selectedPrecision);
      if (this.processingAborted) return;

      const finalImageData = composeAtOriginal({
        originalRgba: originalImageData.data,
        originalWidth: originalImageData.width,
        originalHeight: originalImageData.height,
        workingRgba: result.workingPixels,
        workingWidth: result.workingWidth,
        workingHeight: result.workingHeight,
        workingAlpha: result.workingAlpha,
        inpaintMask: result.watermarkMask,
      });
      const nukedPct = result.nukedPct;
      const totalTimeMs = result.totalTimeMs;

      const { exportPng } = await import('../utils/image-io');
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
      // Hide editor if it was open from a previous edit
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
    } catch (err) {
      if (this.processingAborted) return;
      console.error('Pipeline error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.progress.setStage('ml-segmentation', 'error', t('pipeline.error', { msg }));
    } finally {
      if (!this.processingAborted) {
        this.isProcessing = false;
        this.enableWorkspaceButtons();
      }
    }
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
      this.batchCurrentProcessingItem = item;
      if (this.batchGrid) this.batchGrid.updateItem(item.id, 'processing');
      try {
        const result = await this.pipeline!.process(
          item.imageData,
          ArApp.MODEL_ID,
          this.selectedPrecision,
        );
        if (this.batchAborted) return;
        const finalImageData = composeAtOriginal({
          originalRgba: item.originalImageData.data,
          originalWidth: item.originalImageData.width,
          originalHeight: item.originalImageData.height,
          workingRgba: result.workingPixels,
          workingWidth: result.workingWidth,
          workingHeight: result.workingHeight,
          workingAlpha: result.workingAlpha,
          inpaintMask: result.watermarkMask,
        });
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
        item.errorMessage = err instanceof Error ? err.message : String(err);
        item.state = 'failed';
        if (this.batchGrid) this.batchGrid.updateItem(item.id, 'failed');
        if (this.batchDetailId === item.id) {
          await this.openBatchDetail(item.id);
        }
      }
    }
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
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      this.download.reset();
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'none';
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
      return;
    }

    if (item.state === 'failed') {
      failedBar.style.display = 'flex';
      if (retryBtn) retryBtn.style.display = 'inline-block';
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
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      // Replay per-item stage history so each finished image shows its own
      // icons (done/skipped) and timings — previously we just reset(),
      // which left every stage 'pending' and blanked out every icon.
      this.replayStageHistory(item.stageHistory);
      this.download.reset();
      const { exportPng } = await import('../utils/image-io');
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
    const { exportPng } = await import('../utils/image-io');
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
      this.batchItems = [];
      this.batchDetailId = null;
      this.batchMode = 'off';
    }
    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
