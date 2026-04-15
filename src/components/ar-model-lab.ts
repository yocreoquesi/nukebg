/**
 * Model-lab selector: dropdowns for model + inference mode.
 *
 * Visible only when exploration/lab-visibility.ts says we're on a staging
 * or local host. Production never mounts this element.
 *
 * Emits `ar:lab-state` custom events on document with the new state whenever
 * the user changes a dropdown. Consumers (ar-app) import lab-state directly,
 * so the event is purely for coarse lifecycle (e.g. re-run the last image).
 */

import { isLabVisible } from '../../exploration/lab-visibility';
import {
  getLabState,
  setLabState,
  onLabStateChange,
  type LabState,
} from '../../exploration/lab-state';
import { hasHfToken } from '../../exploration/hf-token';

interface ModelOption {
  value: LabState['model'];
  label: string;
  gated?: boolean;
}
const MODELS: ModelOption[] = [
  { value: 'baseline', label: 'RMBG-1.4 (baseline, prod pipeline)' },
  { value: 'rmbg-1.4', label: 'RMBG-1.4 (lab, supports bbox-refine)' },
  { value: 'rmbg-2.0', label: 'RMBG-2.0 (~176 MB, CC BY-NC)', gated: true },
  { value: 'birefnet-lite', label: 'BiRefNet-lite (Swin-T, ~115 MB, MIT)' },
  { value: 'birefnet-general', label: 'BiRefNet-general (~490 MB, MIT, may OOM on WASM)' },
];

const MODES: { value: LabState['mode']; label: string }[] = [
  { value: 'single-pass', label: 'Single-pass' },
  { value: 'bbox-refine', label: 'Bbox-refine (2 passes)' },
];

export class ArModelLab extends HTMLElement {
  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
    this.unsubscribe = onLabStateChange(() => this.syncSelects());
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(): void {
    const state = getLabState();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          padding: 8px 12px;
          border: 1px dashed var(--color-border, #444);
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text, #ddd);
          background: rgba(255, 215, 0, 0.04);
        }
        .tag {
          color: var(--color-accent, #ffd700);
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 10px;
          text-transform: uppercase;
          color: var(--color-text-secondary, #999);
        }
        select {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-text, #ddd);
          border: 1px solid var(--color-border, #444);
          border-radius: 2px;
          padding: 4px 6px;
          min-width: 220px;
        }
        select:disabled { opacity: 0.4; cursor: not-allowed; }
        .note { font-size: 10px; color: var(--color-text-tertiary, #666); }
      </style>
      <span class="tag">[LAB]</span>
      <label>
        Model
        <select id="model">
          ${MODELS.map((m) => {
            const disabled = m.gated && !hasHfToken();
            const suffix = disabled ? ' — HF token required' : '';
            return `<option value="${m.value}"${m.value === state.model ? ' selected' : ''}${disabled ? ' disabled' : ''}>${m.label}${suffix}</option>`;
          }).join('')}
        </select>
      </label>
      <label>
        Mode
        <select id="mode">
          ${MODES.map(
            (m) =>
              `<option value="${m.value}"${m.value === state.mode ? ' selected' : ''}>${m.label}</option>`,
          ).join('')}
        </select>
      </label>
      <span class="note">staging-only · loader downloads weights from HF on first run</span>
    `;

    const modelSelect = shadow.getElementById('model') as HTMLSelectElement;
    const modeSelect = shadow.getElementById('mode') as HTMLSelectElement;

    modelSelect.addEventListener('change', () => {
      setLabState({ model: modelSelect.value as LabState['model'] });
      this.applyModeAvailability(modeSelect);
      document.dispatchEvent(new CustomEvent('ar:lab-state', { detail: getLabState() }));
    });
    modeSelect.addEventListener('change', () => {
      setLabState({ mode: modeSelect.value as LabState['mode'] });
      document.dispatchEvent(new CustomEvent('ar:lab-state', { detail: getLabState() }));
    });

    this.applyModeAvailability(modeSelect);
  }

  /** Mode selector has no effect on the baseline path — disable it there. */
  private applyModeAvailability(modeSelect: HTMLSelectElement): void {
    const state = getLabState();
    modeSelect.disabled = state.model === 'baseline';
  }

  private syncSelects(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const state = getLabState();
    const modelSelect = shadow.getElementById('model') as HTMLSelectElement | null;
    const modeSelect = shadow.getElementById('mode') as HTMLSelectElement | null;
    if (modelSelect && modelSelect.value !== state.model) modelSelect.value = state.model;
    if (modeSelect && modeSelect.value !== state.mode) modeSelect.value = state.mode;
    if (modeSelect) this.applyModeAvailability(modeSelect);
  }
}

customElements.define('ar-model-lab', ArModelLab);
