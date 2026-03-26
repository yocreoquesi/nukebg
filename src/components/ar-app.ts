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
  private selectedPrecision: 'permissive' | 'standard' | 'aggressive' = 'standard';
  private lastResultImageData: ImageData | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.setupComponents();
    this.setupEvents();
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
          color: #00ff41;
          text-shadow: 0 0 10px rgba(0, 255, 65, 0.4);
        }
        h1::before {
          content: '$ ';
          color: #006622;
        }
        h1 .accent {
          color: #00ff41;
          text-shadow: 0 0 12px rgba(0, 255, 65, 0.5);
        }
        .subline {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-sm, 0.875rem);
          color: #00cc33;
          max-width: none;
          margin: 0 0 var(--space-4, 1rem);
          text-align: left;
          line-height: var(--leading-relaxed, 1.625);
        }
        .subline::before {
          content: '# ';
          color: #006622;
        }
        .model-status {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--text-xs, 0.75rem);
          color: #006622;
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
          color: #00ff41;
          margin-bottom: var(--space-2, 0.5rem);
        }
        .feature-title::before {
          content: '> ';
          color: #006622;
        }
        .feature-desc {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #00cc33;
          line-height: 1.5;
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
          gap: var(--space-3, 0.75rem);
          padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
          border: 1px solid #1a3a1a;
          border-radius: 0;
          background: #000;
          font-family: 'JetBrains Mono', monospace;
        }
        .model-selector label {
          font-size: var(--text-sm, 0.875rem);
          color: #006622;
          white-space: nowrap;
          font-family: 'JetBrains Mono', monospace;
        }
        .model-selector select {
          background: #0a0a0a;
          color: #00ff41;
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
          accent-color: #00ff41;
          cursor: pointer;
        }
        .precision-label {
          font-size: var(--text-xs, 0.75rem);
          color: #00ff41;
          min-width: 70px;
          text-align: center;
        }
        .reprocess-btn {
          background: #00ff41;
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
          color: #00ff41;
          border-color: #00ff41;
          box-shadow: 0 0 10px rgba(0, 255, 65, 0.1);
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
          <input type="range" id="precision-slider" min="0" max="2" value="1" step="1" aria-label="Precision level">
          <span class="precision-label" id="precision-label">Standard</span>
        </div>
        <ar-dropzone></ar-dropzone>
        <p class="model-status" id="model-status">${t('hero.modelStatus')}</p>
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
            <span class="model-desc" id="model-desc-ws"></span>
            <button id="reprocess-btn" class="reprocess-btn" aria-label="${t('model.reprocess')}">${t('model.reprocess')}</button>
          </div>
          <ar-download></ar-download>
          <button class="edit-btn" id="edit-btn" style="display:none">${t('edit.btn')}</button>
          <ar-editor style="display:none" id="editor-section"></ar-editor>
        </div>
      </section>

      <section class="features" aria-label="Key features">
        <h2 class="sr-only">${t('features.srTitle')}</h2>
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">&#9889;</div>
          <h3 class="feature-title">${t('features.bgRemoval.title')}</h3>
          <p class="feature-desc">
            ${t('features.bgRemoval.desc')}
          </p>
        </article>
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">&#9762;</div>
          <h3 class="feature-title">${t('features.aiArtifacts.title')}</h3>
          <p class="feature-desc">
            ${t('features.aiArtifacts.desc')}
          </p>
        </article>
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">&#128274;</div>
          <h3 class="feature-title">${t('features.private.title')}</h3>
          <p class="feature-desc">
            ${t('features.private.desc')}
          </p>
        </article>
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

    // Precision slider — 3 positions: Permissive (0), Standard (1), Aggressive (2)
    const precisionLabels = ['Permissive', 'Standard', 'Aggressive'];
    this.shadowRoot!.querySelector('#precision-slider')?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value);
      this.selectedPrecision = (['permissive', 'standard', 'aggressive'] as const)[val];
      const label = this.shadowRoot!.querySelector('#precision-label');
      if (label) label.textContent = precisionLabels[val];
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
      // Map precision to threshold: Permissive=0.3 (keep more), Standard=0.5, Aggressive=0.7 (remove more)
      const thresholdMap = { permissive: 0.3, standard: 0.5, aggressive: 0.7 } as const;
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
