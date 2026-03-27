import { PipelineOrchestrator } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import { MODEL_OPTIONS } from '../types/worker-messages';
import { t } from '../i18n';
import type { ArViewer } from './ar-viewer';
import type { ArProgress } from './ar-progress';
import type { ArDownload } from './ar-download';
import type { ArEditor } from './ar-editor';

/**
 * Detect if an image is an illustration or a photo.
 * Illustrations: fewer unique colors, more flat areas, high saturation uniformity.
 * Photos: many unique colors, smooth gradients, varied saturation.
 */
function detectImageType(imageData: ImageData): 'illustration' | 'photo' {
  const { data, width, height } = imageData;
  // Sample every 4th pixel for speed on large images
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 10000)));
  const colorSet = new Set<number>();
  let flatPatches = 0;
  let totalPatches = 0;

  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const i = (y * width + x) * 4;
      // Quantize to 6-bit per channel for color counting
      const key = ((data[i] >> 2) << 12) | ((data[i + 1] >> 2) << 6) | (data[i + 2] >> 2);
      colorSet.add(key);

      // Check if neighboring pixel is very similar (flat patch)
      const j = ((y + step) * width + (x + step)) * 4;
      const diff = Math.abs(data[i] - data[j]) + Math.abs(data[i+1] - data[j+1]) + Math.abs(data[i+2] - data[j+2]);
      totalPatches++;
      if (diff < 15) flatPatches++;
    }
  }

  const uniqueColors = colorSet.size;
  const flatRatio = totalPatches > 0 ? flatPatches / totalPatches : 0;

  // Illustrations: fewer colors + more flat areas
  // Threshold tuned on AI-generated illustrations vs photos
  if (uniqueColors < 3000 || flatRatio > 0.6) return 'illustration';
  return 'photo';
}

/** Recommend best model based on image type */
function recommendModel(type: 'illustration' | 'photo'): ModelId {
  if (type === 'photo') return 'Xenova/modnet';
  return 'briaai/RMBG-1.4';
}

export class ArApp extends HTMLElement {
  private pipeline: PipelineOrchestrator | null = null;
  private viewer!: ArViewer;
  private progress!: ArProgress;
  private download!: ArDownload;
  private editor!: ArEditor;
  private currentFileName = 'image.png';
  private currentImageData: ImageData | null = null;
  private currentFileSize = 0;
  private selectedModel: ModelId = MODEL_OPTIONS[0].id;
  private selectedPrecision: 'low-power' | 'keep-more' | 'balanced' | 'clean-more' | 'full-nuke' = 'balanced';
  private lastResultImageData: ImageData | null = null;
  private crtFlickerTimers: number[] = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.setupComponents();
    this.setupEvents();
  }

  disconnectedCallback(): void {
    this.crtFlickerTimers.forEach(id => clearInterval(id));
    this.crtFlickerTimers = [];
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
          color: var(--color-text-tertiary, #006622);
        }
        h1 .accent {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 12px rgba(0, 255, 65, 0.5);
        }
        .subline {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-sm, 0.875rem);
          color: var(--color-text-secondary, #00cc33);
          max-width: none;
          margin: 0 0 var(--space-4, 1rem);
          text-align: left;
          line-height: var(--leading-relaxed, 1.625);
        }
        .subline::before {
          content: '# ';
          color: var(--color-text-tertiary, #006622);
        }
        .model-status {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #006622);
          margin-top: var(--space-2, 0.5rem);
          min-height: 1.2em;
        }
        .model-status::before {
          content: '[STATUS] ';
        }
        .model-status.ready {
          color: var(--color-success, #00ff41);
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
          color: var(--color-text-tertiary, #006622);
        }
        .feature-desc {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00cc33);
          line-height: 1.5;
        }
        .features-disclaimer {
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--color-text-tertiary, #006622);
          margin-top: var(--space-4, 1rem);
          padding: 0 var(--space-4, 1rem);
        }
        .features-disclaimer s {
          color: var(--color-text-tertiary, #006622);
          text-decoration: line-through;
          opacity: 0.7;
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
        .model-selector {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
          gap: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
          border: 1px solid #1a3a1a;
          border-radius: 0;
          background: #000;
          font-family: 'JetBrains Mono', monospace;
        }
        .model-selector label {
          font-size: var(--text-sm, 0.875rem);
          color: var(--color-text-tertiary, #006622);
          white-space: nowrap;
          font-family: 'JetBrains Mono', monospace;
        }
        .model-selector select {
          background: #0a0a0a;
          color: var(--color-accent-primary, #00ff41);
          border: 1px solid #1a3a1a;
          border-radius: 0;
          padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
          font-size: var(--text-sm, 0.875rem);
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
        }
        .model-desc {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #006622);
          flex: 1;
        }
        .precision-sep {
          color: #1a3a1a;
          margin: 0 var(--space-1, 0.25rem);
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
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 4px 0;
          margin-top: var(--space-1, 0.25rem);
          min-height: 24px;
          position: relative;
          color: #006622;
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
        .ws-precision {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2, 0.5rem);
          padding: var(--space-2, 0.5rem) 0;
        }
        .reprocess-btn {
          background: var(--color-accent-primary, #00ff41);
          color: #000;
          border: none;
          border-radius: 0;
          padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
          font-size: 11px;
          font-weight: var(--font-semibold, 600);
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        .reprocess-btn:hover {
          background: var(--color-accent-hover, #33ff66);
          box-shadow: var(--shadow-glow);
        }
        .edit-btn {
          width: 100%;
          background: transparent;
          color: var(--color-text-secondary, #00cc33);
          border: 1px solid #1a3a1a;
          border-radius: 0;
          padding: var(--space-3, 0.75rem);
          font-size: 11px;
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
          color: var(--terminal-color-override, #006622);
        }
        :host(.precision-override) .subline,
        :host(.precision-override) .feature-desc,
        :host(.precision-override) .model-desc,
        :host(.precision-override) .model-selector label,
        :host(.precision-override) .model-status {
          color: var(--terminal-color-override, #00cc33);
        }
        :host(.precision-override) .feature-title,
        :host(.precision-override) .precision-label,
        :host(.precision-override) .model-selector select {
          color: var(--terminal-color-override, #00ff41);
        }
        :host(.precision-override) .edit-btn {
          color: var(--terminal-color-override, #00cc33);
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
          opacity: 0.3;
        }
        @media (prefers-reduced-motion: reduce) {
          .feature-card.crt-flicker .feature-title,
          .feature-card.crt-flicker .feature-desc,
          .feature-card.crt-flicker .feature-icon {
            opacity: 1;
          }
        }

        /* === Layout stability fixes === */
        .model-desc {
          min-height: 2.5em;
        }
        .model-selector {
          min-height: 3.5em;
        }
        .model-selector select {
          min-width: 160px;
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
          .model-selector {
            flex-direction: column;
            align-items: stretch;
            gap: var(--space-2, 0.5rem);
            padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
          }
          .model-selector label {
            font-size: var(--text-xs, 0.75rem);
          }
          .model-selector select {
            width: 100%;
            min-height: 44px;
          }
          .model-desc {
            font-size: 10px;
          }
          .reprocess-btn {
            width: 100%;
            min-height: 44px;
            padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
            font-size: 12px;
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
            font-size: 11px;
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
          .model-selector {
            flex-wrap: wrap;
          }
          .model-selector select {
            min-height: 44px;
          }
          .reprocess-btn {
            min-height: 44px;
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
          .reprocess-btn,
          .edit-btn,
          .model-selector select {
            min-height: 44px;
            min-width: 44px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .feature-card, .reprocess-btn, .edit-btn {
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
          color: var(--color-text-tertiary, #006622);
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
          color: var(--color-text-tertiary, #006622);
        }
        :host .features[data-card-layout="A"] .feature-desc {
          display: inline;
          font-size: 12px;
          color: var(--color-text-secondary, #00cc33);
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
            font-size: 11px;
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
          color: var(--color-text-secondary, #00cc33);
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
            font-size: 11px;
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
          font-size: 11px;
          color: var(--color-text-secondary, #00cc33);
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
            font-size: 10px;
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
        <div class="model-selector" id="model-selector-hero">
          <label for="model-select">${t('model.label')}</label>
          <select id="model-select" aria-label="${t('model.label')}">
            ${MODEL_OPTIONS.map(m => `<option value="${m.id}" ${m.id === this.selectedModel ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
          <span class="model-desc" id="model-desc">${this.getModelDescription(MODEL_OPTIONS[0].id)}</span>
          <span class="precision-sep">|</span>
          <label for="precision-slider">Precision:</label>
          <input type="range" id="precision-slider" min="0" max="4" value="2" step="1" aria-label="Precision level">
          <span class="precision-label" id="precision-label">Balanced</span>
        </div>
        <ar-dropzone></ar-dropzone>
        <p class="model-status" id="model-status">${t('hero.modelStatus')}</p>
        <div class="precision-marquee" id="precision-marquee"><span>\u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622</span></div>
        <div class="smoke-effect" id="smoke-effect"></div>
      </section>

      <section class="workspace" id="workspace" aria-label="Image processing workspace">
        <div class="workspace-inner">
          <ar-viewer></ar-viewer>
          <ar-progress></ar-progress>
          <div class="model-selector" id="model-selector-workspace">
            <label>${t('model.tryAnother')}</label>
            <select id="model-select-ws" aria-label="${t('model.label')}">
              ${MODEL_OPTIONS.map(m => `<option value="${m.id}" ${m.id === this.selectedModel ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <button id="reprocess-btn" class="reprocess-btn" aria-label="${t('model.reprocess')}">${t('model.reprocess')}</button>
          </div>
          <div class="ws-precision">
            <input type="range" id="precision-slider-ws" min="0" max="4" value="2" step="1" aria-label="Precision level">
            <span class="precision-label" id="precision-label-ws">Balanced</span>
          </div>
          <div class="precision-marquee" id="precision-marquee-ws"><span>\u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622</span></div>
          <ar-download></ar-download>
          <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
        </div>
      </section>

      <section class="features" aria-label="Key features" data-card-layout="A">
        <h2 class="sr-only">${t('features.srTitle')}</h2>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#9889;</div>
          <h3 class="feature-title">${t('features.bgRemoval.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.bgRemoval.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#9762;</div>
          <h3 class="feature-title">${t('features.aiArtifacts.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.aiArtifacts.desc')}
          </p>
        </article>
        <article class="feature-card">
          <span class="terminal-prefix" aria-hidden="true">[+]</span>
          <div class="feature-icon" aria-hidden="true">&#128274;</div>
          <h3 class="feature-title">${t('features.private.title')}</h3>
          <span class="feature-sep" aria-hidden="true"> — </span>
          <p class="feature-desc">
            ${t('features.private.desc')}
          </p>
        </article>
        <p class="features-disclaimer" id="features-disclaimer">${t('features.disclaimer')}</p>
      </section>
    `;
  }

  private setupComponents(): void {
    this.viewer = this.shadowRoot!.querySelector('ar-viewer')!;
    this.progress = this.shadowRoot!.querySelector('ar-progress')!;
    this.download = this.shadowRoot!.querySelector('ar-download')!;
    this.editor = this.shadowRoot!.querySelector('ar-editor')!;
  }

  /** Obtiene la descripcion traducida del modelo */
  private getModelDescription(modelId: string): string {
    if (modelId === 'briaai/RMBG-1.4') return t('model.rmbg.description');
    if (modelId === 'Xenova/modnet') return t('model.modnet.description');
    return '';
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
    const heroLabel = root.querySelector('#model-selector-hero label');
    if (heroLabel) heroLabel.textContent = t('model.label');
    const heroDesc = root.querySelector('#model-desc');
    if (heroDesc) heroDesc.textContent = this.getModelDescription(this.selectedModel);
    const wsLabel = root.querySelector('#model-selector-workspace label');
    if (wsLabel) wsLabel.textContent = t('model.tryAnother');
    const reprocessBtn = root.querySelector('#reprocess-btn');
    if (reprocessBtn) reprocessBtn.textContent = t('model.reprocess');
    const editBtn = root.querySelector('#edit-btn');
    if (editBtn) editBtn.textContent = t('edit.btn');
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
  }

  private setupEvents(): void {
    // Escuchar cambio de idioma
    document.addEventListener('nukebg:locale-changed', () => {
      this.updateTexts();
    });

    this.shadowRoot!.addEventListener('ar:image-loaded', async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.currentFileName = detail.file.name || 'image.png';

      // Auto-detect image type and recommend model (only if user hasn't manually selected)
      const heroSelect = this.shadowRoot!.querySelector('#model-select') as HTMLSelectElement;
      if (heroSelect && this.selectedModel === MODEL_OPTIONS[0].id) {
        const imgType = detectImageType(detail.imageData);
        const recommended = recommendModel(imgType);
        if (recommended !== this.selectedModel) {
          this.selectedModel = recommended;
          heroSelect.value = recommended;
          const desc = MODEL_OPTIONS.find(m => m.id === recommended)?.description || '';
          const descEl = this.shadowRoot!.querySelector('#model-desc');
          if (descEl) descEl.textContent = t('model.autoDetected', { type: imgType, desc });
        }
      }

      await this.processImage(detail.imageData, detail.file.size);
    });

    this.shadowRoot!.addEventListener('ar:process-another', () => {
      this.resetToIdle();
    });

    // Hero model selector — changes default model before processing
    this.shadowRoot!.querySelector('#model-select')?.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      this.selectedModel = select.value as ModelId;
      const desc = this.getModelDescription(this.selectedModel);
      const descEl = this.shadowRoot!.querySelector('#model-desc');
      if (descEl) descEl.textContent = desc;
    });

    // Precision slider — 5 positions with visual effects at extremes
    const precisionKeys = ['low-power', 'keep-more', 'balanced', 'clean-more', 'full-nuke'] as const;
    const precisionLabels = ['Low Power', 'Keep More', 'Balanced', 'Clean More', 'Full Nuke'];
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

      if (val === 4) {
        // Full Nuke — red override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#cc3333');
        document.documentElement.style.setProperty('--color-text-primary', '#cc3333');
        document.documentElement.style.setProperty('--color-text-secondary', '#aa2222');
        document.documentElement.style.setProperty('--color-accent-primary', '#cc3333');
        this.classList.add('precision-override');
        // Stop CRT flicker in Full Nuke
        this.stopCrtFlicker();
        updateMarquees('#cc3333', '<span>\u26A0 MAXIMUM POWER \u26A0 MAXIMUM POWER \u26A0 MAXIMUM POWER \u26A0</span>');

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
      } else if (val === 0) {
        // Low Power — yellow override (shadow DOM + global properties)
        document.documentElement.style.setProperty('--terminal-color-override', '#b8a500');
        document.documentElement.style.setProperty('--color-text-primary', '#b8a500');
        document.documentElement.style.setProperty('--color-text-secondary', '#8a7d00');
        document.documentElement.style.setProperty('--color-accent-primary', '#b8a500');
        this.classList.add('precision-override');
        // Start CRT flicker only in Low Power
        this.startCrtFlicker();
        updateMarquees('#b8a500', '<span>\u26A1 LOW POWER MODE \u26A1 LOW POWER MODE \u26A1 LOW POWER MODE \u26A1</span>');
        // Hide smoke in Low Power
        if (smoke) smoke.classList.remove('active');
      } else {
        // Normal levels — restore all overrides
        document.documentElement.style.removeProperty('--terminal-color-override');
        document.documentElement.style.removeProperty('--color-text-primary');
        document.documentElement.style.removeProperty('--color-text-secondary');
        document.documentElement.style.removeProperty('--color-accent-primary');
        this.classList.remove('precision-override');
        // Stop CRT flicker in normal modes
        this.stopCrtFlicker();
        // Subtle green marquee for normal modes
        updateMarquees('#006622', '<span>\u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622 NUKEBG \u2014 DROP. NUKE. DOWNLOAD. \u2622</span>');
        // Hide smoke in normal modes
        if (smoke) smoke.classList.remove('active');
      }
    });

    // Workspace precision slider — syncs with hero slider
    this.shadowRoot!.querySelector('#precision-slider-ws')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      // Sync hero slider
      const heroSlider = this.shadowRoot!.querySelector('#precision-slider') as HTMLInputElement;
      if (heroSlider) heroSlider.value = String(val);
      // Trigger the same handler
      heroSlider?.dispatchEvent(new Event('input'));
      // Update workspace label
      const wsLabel = this.shadowRoot!.querySelector('#precision-label-ws');
      if (wsLabel) wsLabel.textContent = precisionLabels[val];
    });

    // Workspace model selector — for reprocessing with a different model
    this.shadowRoot!.querySelector('#model-select-ws')?.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const desc = this.getModelDescription(select.value);
      const descEl = this.shadowRoot!.querySelector('#model-desc-ws');
      if (descEl) descEl.textContent = desc;
    });

    this.shadowRoot!.querySelector('#reprocess-btn')?.addEventListener('click', () => {
      const wsSelect = this.shadowRoot!.querySelector('#model-select-ws') as HTMLSelectElement;
      if (wsSelect && this.currentImageData) {
        this.selectedModel = wsSelect.value as ModelId;
        this.processImage(this.currentImageData, this.currentFileSize);
      }
    });

    // Edit button — opens the manual eraser editor
    this.shadowRoot!.querySelector('#edit-btn')?.addEventListener('click', () => {
      if (this.lastResultImageData) {
        const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
        editorSection.style.display = 'block';
        this.editor.setImage(this.lastResultImageData);
        (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'none';
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
      this.viewer.setResult(editedData, blob);
      await this.download.setResult(editedData, this.currentFileName, 0, blob);
      // Hide editor, show edit button again
      (this.shadowRoot!.querySelector('#editor-section') as HTMLElement).style.display = 'none';
      (this.shadowRoot!.querySelector('#edit-btn') as HTMLElement).style.display = 'block';
    });
  }

  private startCrtFlicker(): void {
    // Don't start if already running
    if (this.crtFlickerTimers.length > 0) return;
    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const cards = this.shadowRoot!.querySelectorAll('.feature-card');
    cards.forEach((card) => {
      const delay = 3000 + Math.random() * 5000; // 3s-8s random
      const timerId = window.setInterval(() => {
        card.classList.add('crt-flicker');
        window.setTimeout(() => card.classList.remove('crt-flicker'), 100);
      }, delay);
      this.crtFlickerTimers.push(timerId);
    });
  }

  private stopCrtFlicker(): void {
    this.crtFlickerTimers.forEach(id => clearInterval(id));
    this.crtFlickerTimers = [];
    const allCards = this.shadowRoot!.querySelectorAll('.feature-card');
    allCards.forEach(c => c.classList.remove('crt-flicker'));
  }

  private async processImage(imageData: ImageData, fileSize: number): Promise<void> {
    this.currentImageData = imageData;
    this.currentFileSize = fileSize;

    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    hero.classList.add('hidden');
    workspace.classList.add('visible');

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
      // Map precision to threshold: 5 levels from conservative to aggressive
      const thresholdMap = { 'low-power': 0.1, 'keep-more': 0.3, 'balanced': 0.5, 'clean-more': 0.7, 'full-nuke': 0.9 } as const;
      const threshold = thresholdMap[this.selectedPrecision];
      const result = await this.pipeline.process(imageData, this.selectedModel, threshold);
      const { exportPng } = await import('../utils/image-io');
      const blob = await exportPng(result.imageData);
      this.viewer.setResult(result.imageData, blob);
      await this.download.setResult(result.imageData, this.currentFileName, result.totalTimeMs, blob);
      this.lastResultImageData = result.imageData;
      // Show the edit button
      const editBtn = this.shadowRoot!.querySelector('#edit-btn') as HTMLElement;
      if (editBtn) editBtn.style.display = 'block';
      // Hide editor if it was open from a previous edit
      const editorSection = this.shadowRoot!.querySelector('#editor-section') as HTMLElement;
      if (editorSection) editorSection.style.display = 'none';
    } catch (err) {
      console.error('Pipeline error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.progress.setStage('ml-segmentation', 'error', t('pipeline.error', { msg }));
    }
  }

  private resetToIdle(): void {
    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    workspace.classList.remove('visible');
    hero.classList.remove('hidden');
    this.download.reset();

    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
