import type { PipelineStage, StageStatus } from '../types/pipeline';
import { t } from '../i18n';

interface StageInfo {
  stage: PipelineStage;
  label: string;
  status: StageStatus | 'pending';
  message?: string;
  timeMs?: number;
}

export class ArProgress extends HTMLElement {
  private stages: StageInfo[] = [];
  private startTimes = new Map<PipelineStage, number>();
  private pipelineStartTime = 0;
  private totalTimeMs: number | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    document.addEventListener('nukebg:locale-changed', () => {
      // Re-traducir labels de stages activos
      this.stages.forEach(s => {
        if (s.stage === 'detect-background') s.label = t('progress.detectBg');
        else if (s.stage === 'watermark-scan') s.label = t('progress.watermarkScan');
        else if (s.stage === 'inpaint') s.label = t('progress.inpaint');
        else if (s.stage === 'background-removal') s.label = t('progress.bgRemoval');
        else if (s.stage === 'checkerboard-removal') s.label = t('progress.bgRemovalCV');
        else if (s.stage === 'ml-segmentation') s.label = t('progress.bgRemovalML');
        else if (s.stage === 'edge-refine') s.label = t('progress.edgeRefine');
      });
      this.update();
    });
  }

  reset(): void {
    this.stages = [
      { stage: 'detect-background', label: t('progress.detectBg'), status: 'pending' },
      { stage: 'watermark-scan', label: t('progress.watermarkScan'), status: 'pending' },
      { stage: 'inpaint', label: t('progress.inpaint'), status: 'pending' },
      { stage: 'background-removal', label: t('progress.bgRemoval'), status: 'pending' },
      { stage: 'edge-refine', label: t('progress.edgeRefine'), status: 'pending' },
    ];
    this.startTimes.clear();
    this.pipelineStartTime = performance.now();
    this.totalTimeMs = null;
    this.update();
  }

  setStage(stage: PipelineStage, status: StageStatus, message?: string): void {
    // Handle dynamic stages (checkerboard-removal, ml-segmentation replace background-removal)
    if (stage === 'checkerboard-removal' || stage === 'ml-segmentation') {
      const bgIdx = this.stages.findIndex(s => s.stage === 'background-removal' ||
                                                 s.stage === 'checkerboard-removal' ||
                                                 s.stage === 'ml-segmentation');
      if (bgIdx >= 0) {
        this.stages[bgIdx].stage = stage;
        this.stages[bgIdx].label = stage === 'checkerboard-removal'
          ? t('progress.bgRemovalCV')
          : t('progress.bgRemovalML');
        this.stages[bgIdx].status = status;
        this.stages[bgIdx].message = message;
      }
    } else if (stage === 'shadow-cleanup') {
      // Shadow cleanup is internal, skip in UI
      return;
    } else {
      const existing = this.stages.find(s => s.stage === stage);
      if (existing) {
        existing.status = status;
        existing.message = message;
      }
    }

    if (status === 'running') {
      this.startTimes.set(stage, performance.now());
    } else if (status === 'done') {
      const start = this.startTimes.get(stage);
      if (start) {
        const stageInfo = this.stages.find(s => s.stage === stage);
        if (stageInfo) {
          stageInfo.timeMs = performance.now() - start;
        }
      }
    }

    // If a stage re-enters 'running' (e.g. post-process refine), reset total timer
    if (status === 'running' && this.totalTimeMs !== null) {
      this.totalTimeMs = null;
      this.pipelineStartTime = performance.now();
    }

    // Check if all stages are complete
    const allDone = this.stages.every(s => s.status === 'done' || s.status === 'skipped' || s.status === 'error');
    if (allDone && this.totalTimeMs === null) {
      this.totalTimeMs = performance.now() - this.pipelineStartTime;
    }

    this.update();
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
        }
        .stages {
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 80px;
          min-height: 80px;
          overflow-y: auto;
          scrollbar-width: none;
        }
        .stages::-webkit-scrollbar {
          display: none;
        }
        .stage {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.5rem);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
        }
        .stage-icon {
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .stage.pending .stage-icon {
          border: 1.5px solid #1a3a1a;
          border-radius: 0;
        }
        .stage.running .stage-icon {
          color: var(--color-accent-primary, #00ff41);
          animation: spin 2s linear infinite;
          filter: drop-shadow(0 0 4px rgba(0, 255, 65, 0.6));
        }
        .stage.done .stage-icon {
          color: var(--color-accent-primary, #00ff41);
        }
        .stage.skipped .stage-icon {
          color: var(--color-text-tertiary, #008830);
        }
        .stage.error .stage-icon {
          color: #ff3131;
        }
        .stage-label {
          flex: 1;
        }
        .stage-time {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #008830);
        }
        .stage-message {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #008830);
        }
        .progress-bar {
          width: 100%;
          height: 3px;
          background: #0d0d0d;
          border-radius: 0;
          margin-top: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--color-accent-primary, #00ff41);
          border-radius: 0;
          box-shadow: 0 0 4px rgba(0, 255, 65, 0.4);
          transition: width 0.3s ease;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .progress-fill.parsing {
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        /* === Mobile (max-width: 480px) === */
        @media (max-width: 480px) {
          :host {
            max-width: 100%;
          }
          .stage {
            font-size: 12px;
            gap: var(--space-1, 0.25rem);
          }
          .stage-icon {
            width: 16px;
            height: 16px;
          }
          .stage-label {
            font-size: 12px;
          }
          .stage-time {
            font-size: 12px;
          }
          .stage-message {
            font-size: 12px;
          }
        }

        /* === Tablet (481px - 768px) === */
        @media (min-width: 481px) and (max-width: 768px) {
          :host {
            max-width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .stage.running .stage-icon { animation: none !important; }
          .progress-fill.parsing { animation: none !important; }
        }

        .total-time {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.5rem);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-accent-primary, #00ff41);
          margin-top: 2px;
        }
        .total-time .total-label {
          color: var(--color-text-secondary, #00dd44);
        }
        .total-time .total-value {
          color: var(--color-accent-primary, #00ff41);
          text-shadow: 0 0 6px rgba(0, 255, 65, 0.4);
        }
      </style>
      <div class="stages" role="progressbar" aria-live="polite"></div>
    `;
  }

  /** Escape HTML entities to prevent XSS from worker error messages */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private update(): void {
    const container = this.shadowRoot!.querySelector('.stages');
    if (!container) return;

    // Filter out stages that shouldn't be shown
    const visibleStages = this.stages.filter(s => {
      // Hide inpaint if skipped (no watermark)
      if (s.stage === 'inpaint' && s.status === 'skipped') return false;
      // Hide edge-refine if skipped or pending (not enabled)
      if (s.stage === 'edge-refine' && (s.status === 'skipped' || s.status === 'pending')) return false;
      return true;
    });

    container.innerHTML = visibleStages.map(s => {
      const icon = this.getIcon(s.status);
      const timeStr = s.timeMs !== undefined ? `${(s.timeMs / 1000).toFixed(1)}s` : '';
      const safeMessage = s.message ? this.escapeHtml(s.message) : '';
      const msgStr = safeMessage ? `<span class="stage-message">${safeMessage}</span>` : '';

      // Extract percentage from message like "Loading AI model... 45%"
      const pctMatch = safeMessage.match(/(\d+)%/);
      let progressBar = '';
      if (s.status === 'running' && pctMatch) {
        const pct = parseInt(pctMatch[1]);
        // At 85% the model is being initialized (WASM compilation) — show pulsing bar
        const isParsing = pct >= 80 && pct < 100;
        const barClass = isParsing ? 'progress-fill parsing' : 'progress-fill';
        const label = isParsing ? t('progress.initAI') : safeMessage;
        progressBar = `<div class="progress-bar"><div class="${barClass}" style="width: ${pct}%"></div></div>`;
        // Override message during parsing phase
        if (isParsing) {
          const msgEl = `<span class="stage-message">${label}</span>`;
          return `
            <div class="stage ${this.escapeHtml(s.status)}">
              <span class="stage-icon">${icon}</span>
              <span class="stage-label">${this.escapeHtml(s.label)}</span>
              ${msgEl}
              <span class="stage-time">${timeStr}</span>
            </div>
            ${progressBar}
          `;
        }
      }

      return `
        <div class="stage ${this.escapeHtml(s.status)}">
          <span class="stage-icon">${icon}</span>
          <span class="stage-label">${this.escapeHtml(s.label)}</span>
          ${msgStr}
          <span class="stage-time">${timeStr}</span>
        </div>
        ${progressBar}
      `;
    }).join('');

    // Show total time when pipeline is complete
    if (this.totalTimeMs !== null) {
      container.innerHTML += `
        <div class="total-time">
          <span class="total-label">&gt; ${t('progress.total')}</span>
          <span class="total-value">${(this.totalTimeMs / 1000).toFixed(1)}s</span>
        </div>
      `;
    }

    // Auto-scroll to bottom (terminal console behavior)
    container.scrollTop = container.scrollHeight;
  }

  private getIcon(status: StageStatus | 'pending'): string {
    switch (status) {
      case 'pending': return '';
      case 'running': return '&#9762;'; // radiation symbol
      case 'done': return '&#10003;';    // checkmark
      case 'skipped': return '&#8212;';  // em dash
      case 'error': return '&#10007;';   // X
    }
  }
}

customElements.define('ar-progress', ArProgress);
