import type { PipelineStage, StageStatus } from '../types/pipeline';
import { t } from '../i18n';
import { on } from '../lib/event-bus';

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
  private detectedContentType: string | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.abortController = new AbortController();
    on(
      document,
      'nukebg:locale-changed',
      () => {
        // Re-translate labels for active stages
        this.stages.forEach((s) => {
          if (s.stage === 'detect-background') s.label = t('progress.detectBg');
          else if (s.stage === 'watermark-scan') s.label = t('progress.watermarkScan');
          else if (s.stage === 'inpaint') s.label = t('progress.inpaint');
          else if (s.stage === 'ml-segmentation') s.label = t('progress.bgRemovalML');
        });
        // Cancel button lives in the ar-app command bar now (#71);
        // its locale update is handled there.
        this.update();
      },
      { signal: this.abortController.signal },
    );

    // #78 — inline error action delegation. Buttons rendered per-stage
    // when status === 'error'; dispatch a composed CustomEvent so the
    // host (ar-app) can wire its existing retry / reload / issue-link
    // paths without this component holding onto them.
    this.shadowRoot!.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement | null)?.closest('.stage-action');
      if (!target) return;
      const stage = target.getAttribute('data-stage') ?? '';
      if (target.classList.contains('stage-action-retry')) {
        this.dispatchEvent(
          new CustomEvent('ar:stage-retry', { bubbles: true, composed: true, detail: { stage } }),
        );
      } else if (target.classList.contains('stage-action-report')) {
        this.dispatchEvent(
          new CustomEvent('ar:stage-report', { bubbles: true, composed: true, detail: { stage } }),
        );
      } else if (target.classList.contains('stage-action-reload')) {
        location.reload();
      }
    });
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  reset(): void {
    this.stages = [
      { stage: 'detect-background', label: t('progress.detectBg'), status: 'pending' },
      { stage: 'watermark-scan', label: t('progress.watermarkScan'), status: 'pending' },
      { stage: 'inpaint', label: t('progress.inpaint'), status: 'pending' },
      { stage: 'ml-segmentation', label: t('progress.bgRemovalML'), status: 'pending' },
    ];
    this.detectedContentType = null;
    this.startTimes.clear();
    this.update();
  }

  /**
   * Toggle the Cancel control visibility. The hosting component
   * (`ar-app`) calls `setRunning(true)` when pipeline.process() starts
   * and `setRunning(false)` when it settles (success, failure, or abort).
   * Clicking the button dispatches `ar:cancel-processing` which the
   * host listens for and wires to its AbortController.
   */
  setRunning(_running: boolean): void {
    // Cancel + visible running chrome moved to the ar-app command bar
    // (#71). Kept as a no-op so existing call sites (host +
    // tests) don't need to change. The state is reflected in the
    // command bar's data-state attribute instead.
  }

  setStage(stage: PipelineStage, status: StageStatus, message?: string): void {
    // Extract content type from detect-background done message (e.g. "solid detected [signature]")
    if (stage === 'detect-background' && status === 'done' && message) {
      const typeMatch = message.match(/\[(\w+)\]/);
      if (typeMatch) {
        this.detectedContentType = typeMatch[1];
        // Enrich the stage 1 label with the detected content type
        const detectStage = this.stages.find((s) => s.stage === 'detect-background');
        if (detectStage) {
          detectStage.label = `${t('progress.detectBg')} [${this.detectedContentType}]`;
        }
      }
    }

    const existing = this.stages.find((s) => s.stage === stage);
    if (existing) {
      existing.status = status;
      existing.message = message;
    }

    if (status === 'running') {
      this.startTimes.set(stage, performance.now());
    } else if (status === 'done') {
      const start = this.startTimes.get(stage);
      if (start) {
        const stageInfo = this.stages.find((s) => s.stage === stage);
        if (stageInfo) {
          stageInfo.timeMs = performance.now() - start;
        }
      }
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
        /* Pipeline always emits 3-4 stages (inpaint skips when no
           watermark). The legacy 80px cap silently clipped the last
           stage behind a hidden scrollbar — dropped per #80. Keep
           min-height so the log row doesn't jump when stages populate. */
        .stages {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-height: 80px;
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
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          line-height: 1;
        }
        .stage.pending .stage-icon {
          border: 1.5px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
        }
        .stage.running .stage-icon {
          color: var(--color-accent-primary, #00ff41);
          animation: spin 2s linear infinite;
          filter: drop-shadow(0 0 4px rgba(var(--color-accent-rgb, 0, 255, 65), 0.6));
        }
        .stage.done .stage-icon {
          color: var(--color-accent-primary, #00ff41);
        }
        .stage.skipped .stage-icon {
          color: var(--color-text-tertiary, #00b34a);
        }
        .stage.error .stage-icon {
          color: var(--color-error, #ff3131);
        }
        .stage-label {
          flex: 1;
        }
        .stage-time {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
        }
        .stage-message {
          font-size: var(--text-xs, 0.75rem);
          color: var(--color-text-tertiary, #00b34a);
        }
        .progress-bar {
          width: 100%;
          height: 3px;
          background: var(--color-bg-secondary, #0d0d0d);
          border-radius: 0;
          margin-top: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--color-accent-primary, #00ff41);
          border-radius: 0;
          box-shadow: 0 0 4px rgba(var(--color-accent-rgb, 0, 255, 65), 0.4);
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

        /* Inline error-stage actions (#78). Mirrors the error modal
           buttons so recovery is available without hunting the
           overlay. Delegates clicks to ar-app via
           ar:stage-retry / ar:stage-report / ar:stage-reload events. */
        .stage-actions {
          display: flex;
          gap: 6px;
          padding: 4px 24px 4px;
          flex-wrap: wrap;
        }
        .stage-action {
          font: inherit;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 3px 10px;
          background: transparent;
          color: var(--color-text-secondary, #00dd44);
          border: 1px solid var(--color-surface-border, #1a3a1a);
          border-radius: 0;
          cursor: pointer;
          min-height: 28px;
        }
        .stage-action:hover,
        .stage-action:focus-visible {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
          outline: none;
        }
        .stage-action-retry {
          color: var(--color-accent-primary, #00ff41);
          border-color: var(--color-accent-primary, #00ff41);
        }
        @media (pointer: coarse) {
          .stage-action { min-height: 40px; padding: 8px 14px; }
        }
      </style>
      <div class="stages" role="log" aria-live="polite"></div>
    `;
    // Cancel button moved to the ar-app command bar (#71). ar-progress
    // still owns the running state (setRunning is called by the host)
    // so it can drive future "show spinner / show done" styling — the
    // `ar:cancel-processing` event is now dispatched from the command
    // bar in ar-app.
  }

  /** Escape HTML entities to prevent XSS from worker error messages */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private update(): void {
    const container = this.shadowRoot!.querySelector('.stages');
    if (!container) return;

    // Filter out stages that shouldn't be shown
    const visibleStages = this.stages.filter((s) => {
      // Hide inpaint if skipped (no watermark)
      if (s.stage === 'inpaint' && s.status === 'skipped') return false;
      return true;
    });

    container.innerHTML = visibleStages
      .map((s) => {
        const icon = this.getIcon(s.status);
        const timeStr = s.timeMs !== undefined ? `${(s.timeMs / 1000).toFixed(1)}s` : '';
        const safeMessage = s.message ? this.escapeHtml(s.message) : '';
        const msgStr = safeMessage ? `<span class="stage-message">${safeMessage}</span>` : '';

        // Extract percentage from message like "Loading AI model... 45%"
        const pctMatch = safeMessage.match(/(\d+)%/);
        let progressBar = '';
        if (s.status === 'running' && pctMatch) {
          const pct = parseInt(pctMatch[1]);
          // At 85% the model is being initialized (WASM compilation) - show pulsing bar
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

        // #78 — when a stage errors, render retry / report / reload
        // actions inline so the user can recover without hunting the
        // modal that the pipeline error surface also raises from #65.
        const errorActions =
          s.status === 'error'
            ? `<div class="stage-actions" role="group" aria-label="Error recovery">
             <button type="button" class="stage-action stage-action-retry" data-stage="${this.escapeHtml(s.stage)}">${this.escapeHtml(t('error.retry'))}</button>
             <button type="button" class="stage-action stage-action-report" data-stage="${this.escapeHtml(s.stage)}">${this.escapeHtml(t('error.report'))}</button>
             <button type="button" class="stage-action stage-action-reload">${this.escapeHtml(t('error.reload'))}</button>
           </div>`
            : '';

        return `
        <div class="stage ${this.escapeHtml(s.status)}">
          <span class="stage-icon">${icon}</span>
          <span class="stage-label">${this.escapeHtml(s.label)}</span>
          ${msgStr}
          <span class="stage-time">${timeStr}</span>
        </div>
        ${progressBar}
        ${errorActions}
      `;
      })
      .join('');

    // Auto-scroll to bottom (terminal console behavior)
    container.scrollTop = container.scrollHeight;
  }

  private getIcon(status: StageStatus | 'pending'): string {
    // Inline SVG renders identically on every system — no dependency on
    // system symbol fonts (Misc Symbols glyphs like ☢ fall back to tofu
    // on minimal Linux installs even with a monospace font stack).
    const svg = (path: string): string =>
      `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">${path}</svg>`;
    switch (status) {
      case 'pending':
        return '';
      case 'running':
        // Arc — rotates via parent .stage.running animation to form a spinner
        return svg('<circle cx="8" cy="8" r="5" stroke-dasharray="18 10"/>');
      case 'done':
        // Check mark
        return svg('<polyline points="3,8 7,12 13,4"/>');
      case 'skipped':
        // Horizontal line
        return svg('<line x1="3" y1="8" x2="13" y2="8"/>');
      case 'error':
        // Cross
        return svg('<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>');
    }
  }
}

customElements.define('ar-progress', ArProgress);
