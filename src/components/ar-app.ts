import { PipelineOrchestrator } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import { t } from '../i18n';
import { installApp, isAppInstalled } from '../sw-register';
import type { ArViewer } from './ar-viewer';
import type { ArProgress } from './ar-progress';
import type { ArDownload } from './ar-download';
import type { ArEditor } from './ar-editor';
import type { ArDropzone } from './ar-dropzone';

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
  private currentFileSize = 0;
  private selectedPrecision: 'low-power' | 'normal' | 'high-power' | 'full-nuke' = 'normal';
  private lastResultImageData: ImageData | null = null;
  private crtFlickerTimers: number[] = [];
  private isProcessing = false;
  private processingAborted = false;
  private preEditResult: ImageData | null = null;
  private cachedEditResult: ImageData | null = null;
  private lastRmbgAlpha: Uint8Array | null = null;
  private preOptimizeResult: ImageData | null = null;
  private boundLocaleHandler: (() => void) | null = null;
  private boundPwaInstallableHandler: (() => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
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
        .workspace-inner {
          max-width: 1200px;
          margin: 0 auto;
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
          color: var(--color-accent-primary, #00ff41);
          margin-bottom: var(--space-2, 0.5rem);
        }
        .feature-title::before {
          content: '> ';
          color: var(--color-text-tertiary, #008830);
        }
        .feature-desc {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
          line-height: 1.5;
        }
        .features-disclaimer {
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
          margin-top: var(--space-4, 1rem);
          padding: 0 var(--space-4, 1rem);
        }
        .features-disclaimer s {
          color: var(--color-text-tertiary, #008830);
          text-decoration: line-through;
          opacity: 0.7;
        }
        .features-kofi {
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-tertiary, #008830);
          margin-top: var(--space-2, 0.5rem);
          padding: 0 var(--space-4, 1rem);
        }
        .features-kofi a {
          color: var(--color-accent-primary, #00ff41);
          text-decoration: none;
          transition: opacity 0.2s ease;
        }
        .features-kofi a:hover {
          opacity: 0.8;
          text-decoration: underline;
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
        .precision-label {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-accent-primary, #00ff41);
          min-width: 90px;
          text-align: center;
          transition: color 0.3s ease;
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

        /* Smoke is rendered outside shadow DOM — see main thread */
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
        .experimental-btn {
          width: 100%;
          background: transparent;
          color: var(--color-experimental, #b8a500);
          border: 1px solid var(--color-experimental-border, #3a3a1a);
          border-radius: 0;
          padding: var(--space-3, 0.75rem);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .experimental-btn:hover {
          color: var(--color-experimental-hover, #e0cc00);
          border-color: var(--color-experimental, #b8a500);
          box-shadow: 0 0 10px rgba(184, 165, 0, 0.15);
        }
        .experimental-btn:disabled {
          opacity: 0.4;
          pointer-events: none;
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
        :host(.precision-override) .feature-desc,
        :host(.precision-override) .model-status {
          color: var(--terminal-color-override, #00dd44);
        }
        :host(.precision-override) .feature-title,
        :host(.precision-override) .precision-label {
          color: var(--terminal-color-override, #00ff41);
        }
        :host(.precision-override) .edit-btn {
          color: var(--terminal-color-override, #00dd44);
          border-color: var(--terminal-color-override, #1a3a1a);
        }
        :host(.precision-override) #precision-slider {
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

        /* Hidden by default — shown per-layout */
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

        /* Layout C mobile — stack to 1 column */
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
        /* Layout C tablet — 2 columns */
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
            <input type="range" id="precision-slider" min="0" max="3" value="1" step="1" aria-label="Precision level">
            <span class="precision-label" id="precision-label">Normal</span>
          </div>
        </div>
        <ar-dropzone></ar-dropzone>
        <p class="model-status" id="model-status">${t('hero.modelStatus')}</p>
        <button class="install-btn" id="install-btn" aria-label="${t('pwa.install')}">${isAppInstalled() ? t('pwa.installed') : t('pwa.install')}</button>
        <div class="install-guide" id="install-guide"></div>
        <div class="precision-marquee" id="precision-marquee"><span>☢ NUKEBG — DROP. NUKE. DOWNLOAD. → nukebg.app ☢ NUKEBG — DROP. NUKE. DOWNLOAD. → nukebg.app ☢</span></div>
        <div class="smoke-effect" id="smoke-effect"></div>
      </section>

      <section class="workspace" id="workspace" aria-label="Image processing workspace">
        <div class="workspace-inner">
          <ar-viewer></ar-viewer>
          <ar-progress></ar-progress>
          <div class="ws-controls">
            <div class="ws-slider-fixed">
              <input type="range" id="precision-slider-ws" min="0" max="3" value="1" step="1" aria-label="Precision level">
              <span class="precision-label" id="precision-label-ws">Normal</span>
            </div>
          </div>
          <div class="precision-marquee" id="precision-marquee-ws"><span>☢ NUKEBG — DROP. NUKE. DOWNLOAD. → nukebg.app ☢ NUKEBG — DROP. NUKE. DOWNLOAD. → nukebg.app ☢</span></div>
          <ar-download></ar-download>
          <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
          <button class="experimental-btn" id="experimental-btn" style="display:none">${t('experimental.btn')}</button>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
        </div>
      </section>

      <section class="features" aria-label="Key features" data-card-layout="A" style="display:none">
        <h2 class="sr-only">${t('features.srTitle')}</h2>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#129504;</div>
          <h3 class="feature-title">${t('features.bgRemoval.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.bgRemoval.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#128274;</div>
          <h3 class="feature-title">${t('features.aiArtifacts.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.aiArtifacts.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#9762;</div>
          <h3 class="feature-title">${t('features.private.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.private.desc')}
          </p>
        </article>
        <p class="features-disclaimer" id="features-disclaimer">${t('features.disclaimer')}</p>
        <p class="features-kofi" id="features-kofi">${t('features.kofi')} <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener noreferrer">\u2615 Ko-fi</a></p>
      </section>
    `;
  }

  private setupComponents(): void {
    this.viewer = this.shadowRoot!.querySelector('ar-viewer')!;
    this.progress = this.shadowRoot!.querySelector('ar-progress')!;
    this.download = this.shadowRoot!.querySelector('ar-download')!;
    this.editor = this.shadowRoot!.querySelector('ar-editor')!;
    this.dropzone = this.shadowRoot!.querySelector('ar-dropzone')! as ArDropzone;
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
    const kofi = root.querySelector('#features-kofi');
    if (kofi) kofi.innerHTML = `${t('features.kofi')} <a href="https://ko-fi.com/yocreoquesi" target="_blank" rel="noopener noreferrer">\u2615 Ko-fi</a>`;
    const installBtnEl = root.querySelector('#install-btn') as HTMLButtonElement;
    if (installBtnEl) {
      installBtnEl.textContent = isAppInstalled() ? t('pwa.installed') : t('pwa.install');
      installBtnEl.setAttribute('aria-label', t('pwa.install'));
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
    // Listen for locale changes
    this.boundLocaleHandler = () => {
      this.updateTexts();
    };
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);

    // PWA install button — mobile only
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
    // (Firefox, Safari — they can install but need manual steps)
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
        closeBtn.addEventListener('click', () => installGuide.classList.remove('visible'));
      }
    });

    this.shadowRoot!.addEventListener('ar:image-loaded', async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.currentFileName = detail.file.name || 'image.png';

      // If currently processing, abort the in-flight pipeline and reset
      if (this.isProcessing) {
        this.processingAborted = true;
        this.isProcessing = false;
        this.enableWorkspaceButtons();
      }

      await this.processImage(detail.imageData, detail.file.size);
    });

    this.shadowRoot!.addEventListener('ar:process-another', () => {
      this.resetToIdle();
    });

    // Precision slider — 4 positions with visual effects at extremes
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
        // Full Nuke — red override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#cc3333');
        document.documentElement.style.setProperty('--color-text-primary', '#cc3333');
        document.documentElement.style.setProperty('--color-text-secondary', '#aa2222');
        document.documentElement.style.setProperty('--color-text-tertiary', '#882222');
        document.documentElement.style.setProperty('--color-accent-primary', '#cc3333');
        document.documentElement.style.setProperty('--color-accent-glow', 'rgba(204,51,51,0.35)');
        this.classList.add('precision-override');
        // Stop CRT flicker in Full Nuke
        this.stopCrtFlicker();
        updateMarquees('#cc3333', '<span>\u26A0 MAXIMUM POWER \u2192 nukebg.app \u26A0 MAXIMUM POWER \u2192 nukebg.app \u26A0</span>');
        console.log('%c[NukeBG] Mode: FULL NUKE', 'color: #cc3333; font-family: monospace;');

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
        // High Power — orange/amber override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#ff8c00');
        document.documentElement.style.setProperty('--color-text-primary', '#ff8c00');
        document.documentElement.style.setProperty('--color-text-secondary', '#cc7000');
        document.documentElement.style.setProperty('--color-text-tertiary', '#995300');
        document.documentElement.style.setProperty('--color-accent-primary', '#ff8c00');
        document.documentElement.style.setProperty('--color-accent-glow', 'rgba(255,140,0,0.35)');
        this.classList.add('precision-override');
        // Stop CRT flicker in High Power
        this.stopCrtFlicker();
        updateMarquees('#ff8c00', '<span>\u26A1 HIGH POWER \u2192 nukebg.app \u26A1 HIGH POWER \u2192 nukebg.app \u26A1</span>');
        console.log('%c[NukeBG] Mode: HIGH POWER', 'color: #ff8c00; font-family: monospace;');
        // Hide smoke in High Power
        if (smoke) smoke.classList.remove('active');
        // Show features in non-Normal modes
        const featuresHP = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresHP) featuresHP.style.display = '';
      } else if (val === 0) {
        // Low Power — yellow override (shadow DOM + global properties)
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
        updateMarquees('#b8a500', '<span>\u26A1 LOW POWER MODE \u2192 nukebg.app \u26A1 LOW POWER MODE \u2192 nukebg.app \u26A1</span>');
        console.log('%c[NukeBG] Mode: LOW POWER', 'color: #b8a500; font-family: monospace;');
        // Hide smoke in Low Power
        if (smoke) smoke.classList.remove('active');
      } else {
        // Normal (val === 1) — restore all overrides
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
        updateMarquees('#008830', '<span>☢ NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2192 nukebg.app ☢ NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2192 nukebg.app ☢</span>');
        console.log('%c[NukeBG] Mode: NORMAL', 'color: #00ff41; font-family: monospace;');
        // Hide smoke in normal modes
        if (smoke) smoke.classList.remove('active');
        // Hide features in Normal mode — clean minimal view
        const featuresSection = this.shadowRoot!.querySelector('.features') as HTMLElement;
        if (featuresSection) featuresSection.style.display = 'none';
      }
    });

    // Workspace precision slider — syncs with hero slider
    this.shadowRoot!.querySelector('#precision-slider-ws')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      // Sync hero slider and visual effects
      const heroSlider = this.shadowRoot!.querySelector('#precision-slider') as HTMLInputElement;
      if (heroSlider) heroSlider.value = String(val);
      heroSlider?.dispatchEvent(new Event('input'));
      const wsLabel = this.shadowRoot!.querySelector('#precision-label-ws');
      if (wsLabel) wsLabel.textContent = precisionLabels[val];
      // No auto-reprocess — user must click Reprocess button
    });

    // Edit button — opens editor or discards edits
    this.shadowRoot!.querySelector('#edit-btn')?.addEventListener('click', async () => {
      if (!this.lastResultImageData) return;

      if (this.preEditResult) {
        // Discard mode: restore pre-edit result, cache edit for instant re-apply
        this.cachedEditResult = this.lastResultImageData;
        this.lastResultImageData = this.preEditResult;
        this.preEditResult = null;

        const { exportPng } = await import('../utils/image-io');
        const blob = await exportPng(this.lastResultImageData);
        if (this.currentImageData) this.viewer.setOriginal(this.currentImageData, this.currentFileSize);
        this.viewer.setResult(this.lastResultImageData, blob);
        await this.download.setResult(this.lastResultImageData, this.currentFileName, 0, blob);

        // Switch button back to "Edit manually"
        const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
        if (editBtn) editBtn.textContent = t('edit.btn');
      } else {
        // Edit mode: open editor, pass cached edit result for instant toggle if available
        const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
        editorSection.style.display = 'block';
        this.editor.setImage(this.cachedEditResult ?? this.lastResultImageData);
        this.cachedEditResult = null;
        (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'none';
      }
    });

    // Experimental SAM refinement (toggle: optimize / undo)
    this.shadowRoot!.querySelector('#experimental-btn')?.addEventListener('click', async () => {
      const experimentalBtn = this.shadowRoot!.querySelector('#experimental-btn') as HTMLButtonElement;
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLButtonElement;

      // UNDO mode: revert to pre-optimization result
      if (this.preOptimizeResult) {
        this.lastResultImageData = this.preOptimizeResult;
        this.preOptimizeResult = null;

        const { exportPng } = await import('../utils/image-io');
        const blob = await exportPng(this.lastResultImageData);
        if (this.currentImageData) this.viewer.setOriginal(this.currentImageData, this.currentFileSize);
        this.viewer.setResult(this.lastResultImageData, blob);
        await this.download.setResult(this.lastResultImageData, this.currentFileName, 0, blob);

        experimentalBtn.textContent = t('experimental.btn');
        if (editBtn) editBtn.disabled = false;
        return;
      }

      // OPTIMIZE mode
      if (!this.currentImageData || !this.lastRmbgAlpha || !this.pipeline) return;

      experimentalBtn.disabled = true;
      experimentalBtn.textContent = t('experimental.processing');

      try {
        this.progress.reset();
        this.progress.setStage('ml-segmentation', 'running', t('experimental.processing'));

        const result = await this.pipeline.experimentalRefine(
          this.currentImageData,
          this.lastRmbgAlpha,
        );

        const { exportPng } = await import('../utils/image-io');
        const blob = await exportPng(result.imageData);

        // Store pre-optimization result and show RMBG as "before"
        this.preOptimizeResult = this.lastResultImageData;
        if (this.preOptimizeResult) this.viewer.setOriginal(this.preOptimizeResult);
        this.viewer.setResult(result.imageData, blob);
        await this.download.setResult(result.imageData, this.currentFileName, result.totalTimeMs, blob);
        this.lastResultImageData = result.imageData;
        this.progress.setStage('ml-segmentation', 'done', t('experimental.done'));

        // Switch to undo mode, disable manual editor
        experimentalBtn.disabled = false;
        experimentalBtn.textContent = t('experimental.undo');
        if (editBtn) editBtn.disabled = true;
      } catch (err) {
        console.error('SAM refinement error:', err);
        experimentalBtn.disabled = false;
        experimentalBtn.textContent = t('experimental.btn');
        const msg = err instanceof Error ? err.message : String(err);
        this.progress.setStage('ml-segmentation', 'error', `Optimization error: ${msg}`);
      }
    });

    // Editor cancel — discard edits, close editor
    this.shadowRoot!.addEventListener('ar:editor-cancel', () => {
      (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
      (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'block';
    });

    // Editor done — update viewer and download with edited result
    this.shadowRoot!.addEventListener('ar:editor-done', async (e: Event) => {
      const editedData = (e as CustomEvent).detail.imageData as ImageData;
      const { exportPng } = await import('../utils/image-io');
      const blob = await exportPng(editedData);

      // Save pre-edit for discard functionality
      this.preEditResult = this.lastResultImageData;
      this.cachedEditResult = editedData;
      this.lastResultImageData = editedData;

      // Viewer compares pre-edit vs post-edit
      if (this.preEditResult) {
        this.viewer.setOriginal(this.preEditResult, this.currentFileSize);
      }
      this.viewer.setResult(editedData, blob);
      await this.download.setResult(editedData, this.currentFileName, 0, blob);

      // Hide editor, show discard button
      (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      editBtn.style.display = 'block';
      editBtn.textContent = t('edit.discard');
    });
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

  private async processImage(imageData: ImageData, fileSize: number): Promise<void> {
    this.processingAborted = false;
    this.isProcessing = true;
    this.disableWorkspaceButtons();

    this.currentImageData = imageData;
    this.currentFileSize = fileSize;
    this.preEditResult = null;
    this.cachedEditResult = null;
    this.lastResultImageData = null;
    this.lastRmbgAlpha = null;
    this.preOptimizeResult = null;
    // Hide experimental button on new image
    const expBtn = this.shadowRoot!.querySelector('#experimental-btn') as HTMLElement;
    if (expBtn) { expBtn.style.display = 'none'; (expBtn as HTMLButtonElement).disabled = false; expBtn.textContent = t('experimental.btn'); }

    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    hero.classList.add('hidden');
    workspace.classList.add('visible');

    this.viewer.clearResult();
    this.viewer.setOriginal(imageData, fileSize);
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
      const result = await this.pipeline.process(imageData, ArApp.MODEL_ID);
      if (this.processingAborted) return;

      const { exportPng } = await import('../utils/image-io');
      if (this.processingAborted) return;

      const blob = await exportPng(result.imageData);
      if (this.processingAborted) return;

      this.viewer.setResult(result.imageData, blob);
      await this.download.setResult(result.imageData, this.currentFileName, result.totalTimeMs, blob);
      if (this.processingAborted) return;

      // Show nuke percentage if background was removed
      if (result.nukedPct > 0) {
        this.progress.setStage('ml-segmentation', 'done', `${result.nukedPct}% nuked`);
      }

      this.lastResultImageData = result.imageData;

      // Extract alpha channel from result for SAM refinement
      const alphaData = new Uint8Array(result.imageData.width * result.imageData.height);
      for (let i = 0; i < alphaData.length; i++) {
        alphaData[i] = result.imageData.data[i * 4 + 3];
      }
      this.lastRmbgAlpha = alphaData;

      // Show edit button
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'block';
      // Show experimental button (only for PHOTO/ILLUSTRATION processed with ML)
      const experimentalBtn = this.shadowRoot!.querySelector('#experimental-btn') as HTMLElement;
      if (experimentalBtn && result.contentType !== 'SIGNATURE') {
        experimentalBtn.style.display = 'block';
      }
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

  private resetToIdle(): void {
    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    workspace.classList.remove('visible');
    hero.classList.remove('hidden');
    this.download.reset();
    this.preEditResult = null;
    this.cachedEditResult = null;
    this.lastResultImageData = null;
    this.currentImageData = null;
    this.lastRmbgAlpha = null;
    this.preOptimizeResult = null;

    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
