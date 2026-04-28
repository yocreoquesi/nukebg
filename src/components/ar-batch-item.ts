import { t } from '../i18n';
import type { BatchItemState } from '../types/batch';
import { on } from '../lib/event-bus';

/**
 * A single slot in the batch grid. Renders a thumbnail plus a state badge
 * and (for processing/failed) a visual overlay. ar-batch-grid creates and
 * drives these; ar-app only talks to the grid.
 */
export class ArBatchItem extends HTMLElement {
  private itemId = '';
  private itemState: BatchItemState = 'pending';
  private thumbnailUrl: string | null = null;
  private originalName = '';
  private abortController: AbortController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.shadowRoot!.addEventListener('click', (e) => {
      e.stopPropagation();
      // Pending slots are non-interactive. Processing IS clickable so the
      // user can open the live progress console for the current item.
      if (this.itemState === 'pending') return;
      this.dispatchEvent(
        new CustomEvent('batch:item-click', {
          bubbles: true,
          composed: true,
          detail: { id: this.itemId, state: this.itemState },
        }),
      );
    });
    this.shadowRoot!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'Enter' && ke.key !== ' ') return;
      if (this.itemState === 'pending') return;
      ke.preventDefault();
      this.dispatchEvent(
        new CustomEvent('batch:item-click', {
          bubbles: true,
          composed: true,
          detail: { id: this.itemId, state: this.itemState },
        }),
      );
    });
    this.abortController = new AbortController();
    on(document, 'nukebg:locale-changed', () => this.updateView(), {
      signal: this.abortController.signal,
    });
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  setItem(
    id: string,
    originalName: string,
    thumbnailUrl: string | null,
    state: BatchItemState,
  ): void {
    this.itemId = id;
    this.originalName = originalName;
    this.thumbnailUrl = thumbnailUrl;
    this.itemState = state;
    if (this.shadowRoot?.firstElementChild) this.updateView();
  }

  updateState(state: BatchItemState, thumbnailUrl?: string | null): void {
    this.itemState = state;
    if (thumbnailUrl !== undefined) this.thumbnailUrl = thumbnailUrl;
    this.updateView();
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          aspect-ratio: 1 / 1;
          position: relative;
          border: 1px solid var(--color-surface-border, #1a3a1a);
          background: #000;
          overflow: hidden;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          outline: none;
        }
        :host([data-clickable="true"]) {
          cursor: pointer;
        }
        :host([data-clickable="true"]:hover),
        :host([data-clickable="true"]:focus-visible) {
          border-color: var(--color-accent-primary, #00ff41);
          box-shadow: 0 0 8px rgba(var(--color-accent-rgb, 0, 255, 65), 0.25);
        }
        :host([data-state="discarded"]) {
          opacity: 0.25;
        }
        :host([data-state="failed"]) {
          border-color: #3a1a1a;
        }
        :host([data-state="failed"][data-clickable="true"]:hover) {
          border-color: #ff3131;
          box-shadow: 0 0 8px rgba(255, 49, 49, 0.3);
        }
        .checker {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(45deg, #0a0a0a 25%, transparent 25%),
            linear-gradient(-45deg, #0a0a0a 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #0a0a0a 75%),
            linear-gradient(-45deg, transparent 75%, #0a0a0a 75%);
          background-size: 12px 12px;
          background-position: 0 0, 0 6px, 6px -6px, -6px 0;
        }
        .thumb {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        .thumb.hidden { display: none; }
        .badge {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          padding: 4px 6px;
          background: rgba(0, 0, 0, 0.78);
          color: var(--color-text-secondary, #00dd44);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: center;
        }
        @media (max-width: 480px) {
          .badge { font-size: 11px; padding: 3px 4px; }
        }
        .badge.ok { color: var(--color-accent-primary, #00ff41); }
        .badge.fail { color: #ff3131; }
        .badge.pending { color: var(--color-text-tertiary, #00b34a); }
        .spinner {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 28px;
          height: 28px;
          border: 2px solid var(--color-surface-border, #1a3a1a);
          border-top-color: var(--color-accent-primary, #00ff41);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .spinner { animation: none; border-top-color: var(--color-surface-border, #1a3a1a); }
        }
        .fail-icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: #ff3131;
          font-size: 28px;
          font-family: 'JetBrains Mono', monospace;
          text-shadow: 0 0 6px rgba(255, 49, 49, 0.5);
        }
        .overlay-dim {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
        }
      </style>
      <div class="checker" aria-hidden="true"></div>
      <img class="thumb hidden" alt="" />
      <div class="overlay" id="overlay" aria-hidden="true"></div>
      <div class="badge" id="badge"></div>
    `;
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'button');
    this.updateView();
  }

  private updateView(): void {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    this.setAttribute('data-state', this.itemState);
    const clickable =
      this.itemState === 'done' || this.itemState === 'failed' || this.itemState === 'processing';
    this.setAttribute('data-clickable', clickable ? 'true' : 'false');

    const img = root.querySelector('.thumb') as HTMLImageElement | null;
    if (img) {
      if (this.thumbnailUrl) {
        img.src = this.thumbnailUrl;
        img.classList.remove('hidden');
      } else {
        img.classList.add('hidden');
      }
    }

    const overlay = root.querySelector('#overlay') as HTMLElement | null;
    if (overlay) {
      overlay.innerHTML = '';
      if (this.itemState === 'processing') {
        overlay.innerHTML = '<div class="overlay-dim"></div><span class="spinner"></span>';
      } else if (this.itemState === 'failed') {
        overlay.innerHTML = '<span class="fail-icon">\u2716</span>';
      }
    }

    const badge = root.querySelector('#badge') as HTMLElement | null;
    if (badge) {
      badge.className = 'badge';
      switch (this.itemState) {
        case 'pending':
          badge.textContent = t('batch.pending');
          badge.classList.add('pending');
          break;
        case 'processing':
          badge.textContent = t('batch.processingState');
          break;
        case 'done':
          badge.textContent = t('batch.done');
          badge.classList.add('ok');
          break;
        case 'failed':
          badge.textContent = t('batch.failed');
          badge.classList.add('fail');
          break;
        case 'discarded':
          badge.textContent = t('batch.discarded');
          break;
      }
    }

    const label = this.originalName
      ? `${this.originalName} \u2014 ${this.itemState}`
      : this.itemState;
    this.setAttribute('aria-label', label);
  }
}

customElements.define('ar-batch-item', ArBatchItem);
