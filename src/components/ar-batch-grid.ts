import { t } from '../i18n';
import type { BatchItem, BatchItemState } from '../types/batch';
import { ArBatchItem } from './ar-batch-item';

/**
 * Presentational container for the batch workflow. Holds BatchItem
 * references, renders one ar-batch-item per slot, and surfaces the
 * "Download ZIP" action. All processing logic lives in ar-app.
 */
export class ArBatchGrid extends HTMLElement {
  private items: BatchItem[] = [];
  private itemEls = new Map<string, ArBatchItem>();
  private boundLocaleHandler: (() => void) | null = null;
  private currentIndex = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.boundLocaleHandler = () => this.updateHeader();
    document.addEventListener('nukebg:locale-changed', this.boundLocaleHandler);
  }

  disconnectedCallback(): void {
    if (this.boundLocaleHandler) {
      document.removeEventListener('nukebg:locale-changed', this.boundLocaleHandler);
      this.boundLocaleHandler = null;
    }
  }

  setItems(items: BatchItem[]): void {
    this.items = items;
    this.renderItems();
    this.updateHeader();
  }

  updateItem(id: string, state: BatchItemState, thumbnailUrl?: string | null): void {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.state = state;
      if (thumbnailUrl !== undefined) item.thumbnailUrl = thumbnailUrl;
    }
    const el = this.itemEls.get(id);
    if (el) el.updateState(state, thumbnailUrl);
    this.updateHeader();
  }

  /** Update the "processing X/N" counter shown in the header while work runs. */
  setCurrentIndex(index: number): void {
    this.currentIndex = index;
    this.updateHeader();
  }

  private render(): void {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          margin: 0 auto;
          max-width: 1200px;
        }
        .header {
          font-size: 12px;
          color: var(--color-text-secondary, #00dd44);
          margin-bottom: 10px;
          text-align: left;
          min-height: 1.4em;
        }
        .header::before {
          content: '[BATCH] ';
          color: var(--color-text-tertiary, #008830);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        @media (max-width: 768px) {
          .grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }
        }
        @media (max-width: 420px) {
          .grid { grid-template-columns: repeat(2, 1fr); }
        }
        .actions {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          justify-content: center;
          flex-wrap: wrap;
        }
        button {
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
        button:hover:not(:disabled) {
          background: rgba(0, 255, 65, 0.08);
          box-shadow: 0 0 8px rgba(0, 255, 65, 0.3);
        }
        button:disabled {
          border-color: #1a3a1a;
          color: var(--color-text-tertiary, #008830);
          cursor: not-allowed;
        }
      </style>
      <div class="header" id="header" aria-live="polite"></div>
      <div class="grid" id="grid"></div>
      <div class="actions">
        <button id="zip-btn" disabled></button>
      </div>
    `;

    this.shadowRoot!.querySelector('#zip-btn')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('batch:download-zip', {
        bubbles: true,
        composed: true,
      }));
    });
  }

  private renderItems(): void {
    const grid = this.shadowRoot!.querySelector('#grid')!;
    grid.innerHTML = '';
    this.itemEls.clear();
    for (const item of this.items) {
      const el = document.createElement('ar-batch-item') as ArBatchItem;
      grid.appendChild(el);
      // setItem needs the shadow DOM to be attached; connectedCallback
      // has run by now because appendChild triggers it synchronously.
      el.setItem(item.id, item.originalName, item.thumbnailUrl, item.state);
      this.itemEls.set(item.id, el);
    }
  }

  private updateHeader(): void {
    const header = this.shadowRoot!.querySelector('#header') as HTMLElement;
    const zipBtn = this.shadowRoot!.querySelector('#zip-btn') as HTMLButtonElement;

    const done = this.items.filter(i => i.state === 'done').length;
    const failed = this.items.filter(i => i.state === 'failed').length;
    const processing = this.items.some(i => i.state === 'processing');
    const total = this.items.length;

    if (processing) {
      header.textContent = t('batch.processing', {
        current: String(this.currentIndex + 1),
        total: String(total),
      });
    } else {
      header.textContent = t('batch.completed', {
        done: String(done),
        total: String(total),
        failed: String(failed),
      });
    }

    zipBtn.textContent = t('batch.downloadZip');
    zipBtn.disabled = done === 0;
  }
}

customElements.define('ar-batch-grid', ArBatchGrid);
