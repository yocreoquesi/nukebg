/**
 * Side-by-side comparison viewer for the model lab.
 *
 * Takes one input image and runs two independent (model, mode) combinations,
 * then renders both results as composited previews next to each other with
 * timing and backend info. Staging-only, like the rest of the lab.
 *
 * Input is handed to this component by ar-app.ts via the `setInput()` method
 * whenever `processImage` runs. The component caches the input and only
 * kicks off inference when the user presses Run.
 */

import { isLabVisible } from '../../exploration/lab-visibility';
import { runLab } from '../../exploration/lab-pipeline';
import type { ModelId, InferenceMode } from '../../exploration/loaders/types';
import { composeAtOriginal } from '../utils/final-composite';

const MODELS: { value: ModelId; label: string }[] = [
  { value: 'rmbg-1.4', label: 'RMBG-1.4 (baseline)' },
  { value: 'rmbg-2.0', label: 'RMBG-2.0' },
  { value: 'birefnet-general', label: 'BiRefNet-general' },
];

const MODES: { value: InferenceMode; label: string }[] = [
  { value: 'single-pass', label: 'single-pass' },
  { value: 'bbox-refine', label: 'bbox-refine' },
];

interface CompareInput {
  imageData: ImageData;
  originalImageData: ImageData;
}

interface SlotConfig {
  model: ModelId;
  mode: InferenceMode;
}

export class ArLabCompare extends HTMLElement {
  private input: CompareInput | null = null;
  private slotA: SlotConfig = { model: 'rmbg-2.0', mode: 'single-pass' };
  private slotB: SlotConfig = { model: 'birefnet-general', mode: 'single-pass' };
  private running = false;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
  }

  setInput(imageData: ImageData, originalImageData: ImageData): void {
    this.input = { imageData, originalImageData };
    this.updateRunButtonState();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          margin-top: 16px;
          padding: 12px;
          border: 1px dashed var(--color-border, #444);
          border-radius: 4px;
          background: rgba(255, 215, 0, 0.03);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text, #ddd);
        }
        .title {
          color: var(--color-accent, #ffd700);
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          font-size: 11px;
          text-transform: uppercase;
        }
        .slots { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .slot {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px;
          border: 1px solid var(--color-border, #444);
          border-radius: 2px;
        }
        .slot-header { display: flex; gap: 8px; }
        label {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 10px;
          color: var(--color-text-secondary, #999);
          text-transform: uppercase;
          flex: 1;
        }
        select {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-text, #ddd);
          border: 1px solid var(--color-border, #444);
          border-radius: 2px;
          padding: 3px 5px;
        }
        .canvas-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(-45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            linear-gradient(-45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            #0d0d0d;
          min-height: 180px;
          border-radius: 2px;
        }
        canvas { max-width: 100%; max-height: 360px; display: block; }
        .stats {
          font-size: 10px;
          color: var(--color-text-tertiary, #888);
          font-family: inherit;
          min-height: 14px;
        }
        .controls {
          margin-top: 10px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        button {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 6px 14px;
          cursor: pointer;
        }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        button:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        .note { font-size: 10px; color: var(--color-text-tertiary, #666); margin-top: 4px; }
        .error { color: #ff6666; font-size: 10px; margin-top: 4px; }
      </style>
      <div class="title">[LAB] Side-by-side comparison</div>
      <div class="slots">
        ${this.slotTemplate('a', this.slotA)}
        ${this.slotTemplate('b', this.slotB)}
      </div>
      <div class="controls">
        <button id="run-btn">Run comparison</button>
      </div>
      <div class="note">Loads current image · downloads weights once per model · results discarded on next run</div>
      <div class="error" id="error"></div>
    `;

    shadow.getElementById('model-a')!.addEventListener('change', (e) => {
      this.slotA.model = (e.target as HTMLSelectElement).value as ModelId;
    });
    shadow.getElementById('mode-a')!.addEventListener('change', (e) => {
      this.slotA.mode = (e.target as HTMLSelectElement).value as InferenceMode;
    });
    shadow.getElementById('model-b')!.addEventListener('change', (e) => {
      this.slotB.model = (e.target as HTMLSelectElement).value as ModelId;
    });
    shadow.getElementById('mode-b')!.addEventListener('change', (e) => {
      this.slotB.mode = (e.target as HTMLSelectElement).value as InferenceMode;
    });
    shadow.getElementById('run-btn')!.addEventListener('click', () => this.runComparison());

    this.updateRunButtonState();
  }

  private slotTemplate(slot: 'a' | 'b', config: SlotConfig): string {
    return `
      <div class="slot">
        <div class="slot-header">
          <label>Model<select id="model-${slot}">
            ${MODELS.map(
              (m) =>
                `<option value="${m.value}"${m.value === config.model ? ' selected' : ''}>${m.label}</option>`,
            ).join('')}
          </select></label>
          <label>Mode<select id="mode-${slot}">
            ${MODES.map(
              (m) =>
                `<option value="${m.value}"${m.value === config.mode ? ' selected' : ''}>${m.label}</option>`,
            ).join('')}
          </select></label>
        </div>
        <div class="canvas-wrap"><canvas id="canvas-${slot}" width="160" height="160"></canvas></div>
        <div class="stats" id="stats-${slot}">—</div>
      </div>
    `;
  }

  private updateRunButtonState(): void {
    const btn = this.shadowRoot?.getElementById('run-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = this.running || this.input === null;
  }

  private async runComparison(): Promise<void> {
    if (!this.input || this.running) return;
    this.running = true;
    this.updateRunButtonState();
    const errorEl = this.shadowRoot!.getElementById('error')!;
    errorEl.textContent = '';
    this.setStats('a', 'running…');
    this.setStats('b', 'running…');

    try {
      // Run sequentially so they don't fight over the GPU / bandwidth during
      // first download. Still gives a clean comparison.
      await this.runSlot('a', this.slotA);
      await this.runSlot('b', this.slotB);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorEl.textContent = `Comparison failed: ${msg}`;
    } finally {
      this.running = false;
      this.updateRunButtonState();
    }
  }

  private async runSlot(slot: 'a' | 'b', config: SlotConfig): Promise<void> {
    const { imageData, originalImageData } = this.input!;
    const started = performance.now();
    const lab = await runLab(config.model, config.mode, {
      pixels: imageData.data,
      width: imageData.width,
      height: imageData.height,
    });

    const final = composeAtOriginal({
      originalRgba: originalImageData.data,
      originalWidth: originalImageData.width,
      originalHeight: originalImageData.height,
      workingRgba: imageData.data,
      workingWidth: imageData.width,
      workingHeight: imageData.height,
      workingAlpha: lab.alpha,
      inpaintMask: null,
    });

    this.paintCanvas(slot, final);
    const totalMs = Math.round(performance.now() - started);
    this.setStats(
      slot,
      `${config.model} · ${config.mode} · ${totalMs}ms · ${lab.backend}${lab.refined ? ' · refined' : ''}`,
    );
  }

  private paintCanvas(slot: 'a' | 'b', img: ImageData): void {
    const canvas = this.shadowRoot!.getElementById(`canvas-${slot}`) as HTMLCanvasElement;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(img, 0, 0);
  }

  private setStats(slot: 'a' | 'b', text: string): void {
    const el = this.shadowRoot?.getElementById(`stats-${slot}`);
    if (el) el.textContent = text;
  }
}

customElements.define('ar-lab-compare', ArLabCompare);
