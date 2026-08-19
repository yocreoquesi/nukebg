import { WorkerPipelineRunner } from '../pipeline/worker-pipeline-runner';
import { PipelineAbortError } from 'nukebg-core';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import { t } from '../i18n';
import { AppInstaller } from '../controllers/app-install';
import { renderArAppTemplate } from './ar-app.template';
import type { ArViewer } from './ar-viewer';
import type { ArProgress } from './ar-progress';
import type { ArDownload } from './ar-download';
import type { ArDropzone } from './ar-dropzone';
import type { ArBatchGrid } from './ar-batch-grid';
import { BatchOrchestrator, type BatchStageCallback } from '../controllers/batch-orchestrator';
import { emit, on } from '../lib/event-bus';
import { refineEdges } from 'nukebg-core/pipeline/finalize';
import { finalizePipelineResult } from 'nukebg-core/pipeline/finalize-result';
import { getRecommendedPipelinePrecision } from '../utils/device-adaptation';
import { autoCropToSubject } from 'nukebg-core/pipeline/auto-crop';
import { exportPng } from '../utils/image-io';
import type { ArEditorAdvanced } from './ar-editor-advanced';
import type { ImageDataLike } from 'nukebg-core';

/** Convert an ImageDataLike plain object to a native ImageData for Canvas/DOM APIs. */
function toImageData(like: ImageDataLike): ImageData {
  return new ImageData(new Uint8ClampedArray(like.data), like.width, like.height);
}

export class ArApp extends HTMLElement {
  private static readonly MODEL_ID: ModelId = 'briaai/RMBG-1.4';
  private pipeline: WorkerPipelineRunner | null = null;
  private viewer!: ArViewer;
  private progress!: ArProgress;
  private download!: ArDownload;
  private dropzone!: ArDropzone;
  private currentFileName = 'image.png';
  private currentImageData: ImageData | null = null;
  private currentOriginalImageData: ImageData | null = null;
  private currentFileSize = 0;
  private lastResultImageData: ImageData | null = null;
  private isProcessing = false;
  private processingAborted = false;
  /** AbortController for the currently-running pipeline. Fires when the
   * user drops a new image mid-process or navigates away, so in-flight
   * worker CPU stops immediately instead of finishing a doomed run. */
  private processingAbortController: AbortController | null = null;
  private abortController: AbortController | null = null;
  /** Owns PWA install button + guide wiring. Initialized in
   *  setupComponents() once the install-btn / install-guide nodes
   *  exist. See #47/Phase-1b. */
  private installer!: AppInstaller;
  private batchGrid: ArBatchGrid | null = null;
  /** Owns batch queue state + per-item processing loop. Wired up in
   *  setupComponents() once UI refs are resolved. See #47/Phase-1. */
  private batch!: BatchOrchestrator;

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
    // Status line: terse "loading..." while warming, "Ready to nuke"
    // when done. Detailed % progress lives inside the dropzone slot —
    // see ar-dropzone.setLoadingState() — so the status line never
    // duplicates the percentage.
    const statusEl = () => this.shadowRoot?.querySelector('#status-model');
    let firstRunSettled = false;

    this.pipeline = new WorkerPipelineRunner(
      (_stage: PipelineStage, _status: StageStatus, message?: string) => {
        if (firstRunSettled) return;
        const m = message?.match(/(\d+)\s*%/);
        if (!m) return;
        const pct = Math.min(100, Math.max(0, parseInt(m[1], 10)));
        this.dropzone.setLoadingState({ visible: true, pct, label: message });
      },
    );

    const el = statusEl();
    if (el) el.textContent = t('status.model.loading');

    // Dropzone is disabled while warming; the loading slot replaces
    // its idle CTAs with a progress bar in the same vertical space so
    // nothing reflows when the model finishes.
    this.dropzone.setEnabled(false);

    // Cold-cache detection: if we haven't settled within 400 ms,
    // surface the in-dropzone progress panel. Instant cache hits never
    // expose the panel.
    const revealTimer = window.setTimeout(() => {
      if (!firstRunSettled) this.dropzone.setLoadingState({ visible: true });
    }, 400);

    const finish = (ready: boolean): void => {
      firstRunSettled = true;
      window.clearTimeout(revealTimer);
      this.dropzone.setLoadingState({ visible: false, ready });
    };

    this.pipeline
      .preload(ArApp.MODEL_ID)
      .then(() => {
        finish(true);
        const s = statusEl();
        if (s) {
          (s as HTMLElement).dataset.state = 'ready';
          s.textContent = t('hero.modelStatus');
          s.classList.add('ready');
        }
        const r = this.shadowRoot?.querySelector('#status-reactor') as HTMLElement | null;
        if (r) {
          r.dataset.state = 'online';
          r.textContent = t('status.reactor.online');
        }
        this.dropzone.setEnabled(true);
      })
      .catch((err: unknown) => {
        finish(false);
        console.error('[NukeBG] Model preload failed, falling back to lazy load:', err);
        const s = statusEl();
        if (s) {
          (s as HTMLElement).dataset.state = 'lazy';
          s.textContent = t('status.model.lazy');
        }
        // Reactor stays "offline" — preload didn't resolve. The lazy-load
        // path will flip it once the first real process() succeeds; until
        // then the user sees an honest "reactor idle" state.
        this.dropzone.setEnabled(true);
      });
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private render(): void {
    // eslint-disable-next-line no-unsanitized/property -- Static shadow DOM template; only t(...) and AR_APP_STYLES from project-owned sources. No user input.
    this.shadowRoot!.innerHTML = renderArAppTemplate();
  }

  private setupComponents(): void {
    this.viewer = this.shadowRoot!.querySelector('ar-viewer')!;
    this.progress = this.shadowRoot!.querySelector('ar-progress')!;
    this.download = this.shadowRoot!.querySelector('ar-download')!;
    this.dropzone = this.shadowRoot!.querySelector('ar-dropzone')! as ArDropzone;
    this.batchGrid = this.shadowRoot!.querySelector('#batch-grid') as ArBatchGrid;

    // PWA install button + guide controller. Lifetime tied to ar-app
    // via the AbortSignal handed to attach() in setupEvents().
    const installBtn = this.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
    const installGuide = this.shadowRoot!.querySelector('#install-guide') as HTMLDivElement;
    this.installer = new AppInstaller(installBtn, installGuide);

    // Batch orchestrator owns queue state + per-item processing. Host
    // (this component) keeps the pipeline + AbortController + thumbnail
    // helper + UI swap, exposed through the BatchHost interface.
    this.batch = new BatchOrchestrator(
      {
        viewer: this.viewer,
        progress: this.progress,
        download: this.download,
        batchGrid: this.batchGrid,
      },
      {
        installBatchStageCallback: (cb: BatchStageCallback) => {
          if (!this.pipeline) {
            this.pipeline = new WorkerPipelineRunner(cb);
          } else {
            this.pipeline.setStageCallback(cb);
          }
          return this.pipeline!;
        },
        setProcessingAbortController: (c) => {
          this.processingAbortController = c;
        },
        makeThumbnail: (img, maxSide) => this.makeThumbnail(img, maxSide),
        enterGridMode: () => this.setBatchUiMode('grid'),
      },
    );
    // When an item finishes mid-processing AND the user is watching its
    // detail view, re-render so they see the result/error without going
    // back to the grid.
    this.batch.setOnItemRefreshed((id) => this.openBatchDetail(id));
  }

  /** Actualiza textos sin re-renderizar todo el componente */
  private updateTexts(): void {
    const root = this.shadowRoot!;
    const h1 = root.querySelector('h1');
    if (h1)
      h1.innerHTML =
        `<span class="hero-title-long"><span class="accent">${t('hero.title.accent')}</span> ${t('hero.title.rest')}</span>` +
        `<span class="hero-title-short"><span class="accent">${t('hero.title.short')}</span></span>`;
    const subline = root.querySelector('.subline');
    if (subline)
      // eslint-disable-next-line no-unsanitized/property -- Trusted i18n only (`t(...)` from src/i18n/index.ts); the `.replace` is on i18n output.
      subline.innerHTML =
        `<span class="subline-long">${t('hero.subtitle').replace(/\n/g, ' ')}</span>` +
        `<span class="subline-short"># ${t('hero.subtitle.short')}</span>`;
    const statusReactor = root.querySelector('#status-reactor');
    if (statusReactor) {
      const state = (statusReactor as HTMLElement).dataset.state ?? 'offline';
      statusReactor.textContent = t(
        state === 'online' ? 'status.reactor.online' : 'status.reactor.offline',
      );
    }
    const statusModel = root.querySelector('#status-model');
    if (statusModel) {
      const state = (statusModel as HTMLElement).dataset.state ?? 'loading';
      const key =
        state === 'ready'
          ? 'hero.modelStatus'
          : state === 'lazy'
            ? 'status.model.lazy'
            : 'status.model.loading';
      statusModel.textContent = t(key);
    }
    const heroDisclaimer = root.querySelector('#hero-disclaimer');
    if (heroDisclaimer) heroDisclaimer.innerHTML = t('features.disclaimer');
    const heroSupport = root.querySelector('#hero-support');
    if (heroSupport) heroSupport.innerHTML = t('support.kofi');
    const statusLimSum = root.querySelector('#status-limits-summary');
    if (statusLimSum) statusLimSum.textContent = `# ${t('status.limitations')}`;
    const statusLimBody = root.querySelector('#status-limits-body');
    if (statusLimBody) statusLimBody.innerHTML = t('features.limitations');
    const advancedPrompt = root.querySelector('#advanced-prompt');
    if (advancedPrompt) advancedPrompt.textContent = t('advanced.cta');
    const advancedBtn = root.querySelector('#advanced-cta');
    if (advancedBtn) advancedBtn.textContent = t('advanced.btn');
    this.installer?.refreshText();
    const backBtnEl = root.querySelector('#back-to-grid-btn');
    if (backBtnEl) backBtnEl.textContent = t('batch.backToGrid');
    const retryBtnEl = root.querySelector('#batch-retry-btn');
    if (retryBtnEl) retryBtnEl.textContent = t('batch.retry');
    const discardBtnEl = root.querySelector('#batch-discard-btn');
    if (discardBtnEl) discardBtnEl.textContent = t('batch.discard');
    const errTitle = root.querySelector('#error-modal-title');
    if (errTitle) errTitle.textContent = t('error.title');
    const errRetry = root.querySelector('#error-modal-retry');
    if (errRetry) errRetry.textContent = t('error.retry');
    const errDismiss = root.querySelector('#error-modal-dismiss');
    if (errDismiss) errDismiss.textContent = t('error.dismiss');
    const cmdStateLabel = root.querySelector('#cmd-state-label') as HTMLElement | null;
    const cmdStateHost = root.querySelector('#cmd-state') as HTMLElement | null;
    if (cmdStateLabel && cmdStateHost) {
      const state = cmdStateHost.getAttribute('data-state') ?? 'running';
      const key =
        state === 'running'
          ? 'cmdbar.running'
          : state === 'ready'
            ? 'cmdbar.ready'
            : 'cmdbar.failed';
      cmdStateLabel.textContent = t(key);
    }
  }

  private setupEvents(): void {
    // Hoisted once so every addEventListener below can reuse it for
    // component-lifecycle cleanup via AbortSignal.
    const signal = this.abortController!.signal;

    on(document, 'nukebg:locale-changed', () => this.updateTexts(), { signal });

    // The cmdbar Cancel button was removed (the abort path it triggered
    // was confusing in practice — workers stopped but state surfaces did
    // not always settle predictably). The underlying
    // processingAbortController is still alive and used by the
    // "drop a new image mid-process" and batch-cancel paths, so the
    // pipeline can still be torn down by other code; only the user-
    // facing button is gone.

    // #78 — inline error-stage actions in ar-progress. Retry reuses
    // the existing retryFromError() path; report opens a pre-filled
    // GitHub issue URL with browser + session hints; reload is
    // handled by ar-progress itself (location.reload).
    on(this.progress, 'ar:stage-retry', () => this.retryFromError(), { signal });
    on(
      this.progress,
      'ar:stage-report',
      ({ stage }) => {
        const ua = encodeURIComponent(navigator.userAgent);
        const title = encodeURIComponent(`[stage:${stage}] pipeline error`);
        const body = encodeURIComponent(
          `**Stage:** \`${stage}\`\n**UA:** ${decodeURIComponent(ua)}\n**Locale:** ${document.documentElement.lang}\n\n<!-- what were you trying to do? drag the image that failed if possible -->`,
        );
        window.open(
          `https://github.com/yocreoquesi/nukebg/issues/new?title=${title}&body=${body}`,
          '_blank',
          'noopener',
        );
      },
      { signal },
    );

    // Error modal wiring (#36).
    const retryBtn = this.shadowRoot!.querySelector(
      '#error-modal-retry',
    ) as HTMLButtonElement | null;
    const dismissBtn = this.shadowRoot!.querySelector(
      '#error-modal-dismiss',
    ) as HTMLButtonElement | null;
    const backdrop = this.shadowRoot!.querySelector('#error-modal-backdrop') as HTMLElement | null;
    retryBtn?.addEventListener('click', () => this.retryFromError());
    dismissBtn?.addEventListener('click', () => this.hideErrorModal());
    backdrop?.addEventListener('click', () => this.hideErrorModal());
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
      if (modal && !modal.hasAttribute('hidden')) {
        e.preventDefault();
        this.hideErrorModal();
      }
    });

    // PWA install button + guide — controller owns the wiring and uses
    // the same AbortSignal so cleanup is automatic on disconnect.
    this.installer.attach(signal);

    on(
      this.shadowRoot!,
      'ar:image-loaded',
      async (detail) => {
        this.currentFileName = detail.file.name || 'image.png';

        // If currently processing, abort the in-flight pipeline and reset
        if (this.isProcessing) {
          this.processingAborted = true;
          this.isProcessing = false;
          this.enableWorkspaceButtons();
        }

        await this.processImage(
          detail.imageData,
          detail.originalImageData ?? detail.imageData,
          detail.file.size,
        );
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'ar:images-loaded',
      async (detail) => {
        if (this.isProcessing) {
          this.processingAborted = true;
          this.isProcessing = false;
          this.enableWorkspaceButtons();
        }
        await this.batch.start(detail.images);
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:item-click',
      ({ id }) => {
        this.openBatchDetail(id);
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:download-zip',
      async () => {
        await this.batch.downloadZip();
      },
      { signal },
    );

    on(
      this.shadowRoot!,
      'batch:cancel',
      () => {
        this.resetToIdle();
      },
      { signal },
    );

    const backBtn = this.shadowRoot!.querySelector('#back-to-grid-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.closeBatchDetail(), { signal });
    }
    const batchRetryBtn = this.shadowRoot!.querySelector('#batch-retry-btn');
    if (batchRetryBtn) {
      batchRetryBtn.addEventListener('click', () => this.retryBatchItem(), { signal });
    }
    const discardBtn = this.shadowRoot!.querySelector('#batch-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => this.discardBatchItem(), { signal });
    }

    on(
      this.shadowRoot!,
      'ar:process-another',
      () => {
        this.resetToIdle();
      },
      { signal },
    );

    // Disclaimer click - toggle limitations detail
    // Limitations now live inside <details id="status-limits"> — native
    // disclosure widget handles open/close. No click wiring needed.

    // Advanced editor CTA toggle
    this.shadowRoot!.querySelector('#advanced-cta')?.addEventListener(
      'click',
      () => {
        const adv = this.shadowRoot!.querySelector('#editor-advanced') as ArEditorAdvanced | null;
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        if (!adv || !btn) return;
        const isOpen = adv.hasAttribute('active');
        if (isOpen) {
          adv.removeAttribute('active');
          btn.removeAttribute('data-active');
          this.setEditorOpen(false);
          return;
        }
        const current = this.lastResultImageData ?? this.currentImageData;
        const original = this.currentOriginalImageData ?? this.currentImageData;
        if (!current || !original) return;
        adv.setImage(current, original);
        adv.setAttribute('active', '');
        btn.setAttribute('data-active', 'true');
        this.setEditorOpen(true);
        adv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      { signal },
    );

    // Advanced editor — cancel
    on(
      this.shadowRoot!,
      'ar:advanced-cancel',
      () => {
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        btn?.removeAttribute('data-active');
        this.setEditorOpen(false);
      },
      { signal },
    );

    // Advanced editor — done
    on(
      this.shadowRoot!,
      'ar:advanced-done',
      async ({ imageData }) => {
        const btn = this.shadowRoot!.querySelector('#advanced-cta') as HTMLElement | null;
        btn?.removeAttribute('data-active');
        this.setEditorOpen(false);

        // Without this catch the rejection becomes an unhandledrejection
        // and the editor leaves the user on a stale result with no
        // signal — the editor has already closed by this point, so the
        // viewer would keep showing the pre-edit image as if nothing
        // had happened. Carried over from the ar:editor-done handler
        // deleted in #353, which is why it reads familiar.
        try {
          // Same reasoning as the basic editor: skip topology cleanup so the
          // user's lasso crops / restores survive the refinement pass.
          const refined = toImageData(
            await refineEdges(this.pipeline, imageData, { skipTopologyCleanup: true }),
          );
          // Same split as elsewhere: slider stays full-size for alignment;
          // export + info label use the cropped subject bbox.
          const exportImageData = toImageData(autoCropToSubject(refined));
          const blob = await exportPng(exportImageData);
          this.viewer.setResult(refined, blob, {
            width: exportImageData.width,
            height: exportImageData.height,
          });
          await this.download.setResult(exportImageData, this.currentFileName, 0, blob);
          this.lastResultImageData = refined;
        } catch (err) {
          console.error('[NukeBG] Applying editor result failed:', err);
          this.showErrorModal(err instanceof Error ? err.message : String(err));
        }
      },
      { signal },
    );
  }

  // The Editor button and its #advanced-prompt sentence appear
  // outside the button so the button label stays tight.
  private setAdvancedBtnVisible(show: boolean): void {
    const cta = this.shadowRoot?.querySelector('#advanced-cta') as HTMLElement | null;
    const prompt = this.shadowRoot?.querySelector('#advanced-prompt') as HTMLElement | null;
    if (!cta) return;
    cta.style.display = show ? 'block' : 'none';
    if (prompt) prompt.style.display = show ? 'block' : 'none';
  }

  /** Toggle the .editor-open class on the persistent status panel.
   *  When the advanced editor is open, the user does not want the
   *  [STATUS] line / limitations / Ko-fi pitch competing for attention
   *  with the editing surface. Every code path that mutates the
   *  advanced editor's `active` attribute also calls this helper. */
  /**
   * Close the advanced editor and clear every piece of state that tracks
   * it being open. Three things drift apart otherwise: the component's
   * `active` attribute, `#advanced-cta[data-active]` (which flips the
   * button into "close" mode) and `.editor-open` on the status panel.
   *
   * Replaces the `#editor-section` hide that #353 removed along with the
   * component it pointed at — the guard itself was still needed.
   */
  private closeAdvancedEditor(): void {
    const adv = this.shadowRoot?.querySelector('#editor-advanced') as HTMLElement | null;
    adv?.removeAttribute('active');
    const cta = this.shadowRoot?.querySelector('#advanced-cta') as HTMLElement | null;
    cta?.removeAttribute('data-active');
    this.setEditorOpen(false);
  }

  private setEditorOpen(open: boolean): void {
    const panel = this.shadowRoot?.querySelector('#status-panel') as HTMLElement | null;
    if (!panel) return;
    panel.classList.toggle('editor-open', open);
  }

  /** Disable all workspace action buttons during processing */
  private disableWorkspaceButtons(): void {
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

  private async processImage(
    imageData: ImageData,
    originalImageData: ImageData,
    fileSize: number,
  ): Promise<void> {
    // If a previous run is still going, hard-abort it so workers stop
    // immediately. Dropping a new image always wins over the previous one.
    if (this.processingAbortController && !this.processingAbortController.signal.aborted) {
      this.processingAbortController.abort('new image dropped');
    }
    this.processingAbortController = new AbortController();
    this.processingAborted = false;
    this.isProcessing = true;
    this.disableWorkspaceButtons();

    this.currentImageData = imageData;
    this.currentOriginalImageData = originalImageData;
    this.currentFileSize = fileSize;

    this.lastResultImageData = null;
    const hero = this.shadowRoot!.querySelector('#hero')!;
    const workspace = this.shadowRoot!.querySelector('#workspace')!;

    // Editor only visible after a successful processing run. Close it
    // here so a new run cannot inherit an editor left open on the
    // previous image — the paste handler lives on document and fires
    // whatever is on screen.
    this.closeAdvancedEditor();

    hero.classList.add('hidden');
    workspace.classList.add('visible');

    this.viewer.clearResult();
    // Show the full-resolution original in the viewer regardless of
    // whether the pipeline worked on a downscaled copy.
    this.viewer.setOriginal(originalImageData, fileSize);
    this.progress.reset();
    this.progress.setRunning(true);
    this.updateCommandBar({
      filename: this.currentFileName,
      width: originalImageData.width,
      height: originalImageData.height,
      sizeBytes: fileSize,
      state: 'running',
    });
    this.download.reset();

    // Reuse existing pipeline (keeps model loaded)
    if (!this.pipeline) {
      this.pipeline = new WorkerPipelineRunner(
        (stage: PipelineStage, status: StageStatus, message?: string) => {
          this.progress.setStage(stage, status, message);
        },
      );
    } else {
      // Update the callback to point to current progress component
      this.pipeline.setStageCallback(
        (stage: PipelineStage, status: StageStatus, message?: string) => {
          this.progress.setStage(stage, status, message);
        },
      );
    }

    try {
      if (
        originalImageData.width !== imageData.width ||
        originalImageData.height !== imageData.height
      ) {
        const msg = t('progress.downscaled', {
          w: String(imageData.width),
          h: String(imageData.height),
          ow: String(originalImageData.width),
          oh: String(originalImageData.height),
        });
        console.info(`[NukeBG] ${msg}`);
      }

      const result = await this.pipeline.run(imageData, {
        precision: getRecommendedPipelinePrecision(),
        signal: this.processingAbortController?.signal,
      });
      if (this.processingAborted) return;

      const finalImageData = toImageData(finalizePipelineResult(result, originalImageData));
      // Tight bbox around the subject for export. Slider keeps full-size
      // (alignment with original) but the downloaded PNG and the info
      // label show the cropped resolution — the user gets a Slack-emote-
      // sized file, not a 4K canvas with a 200×200 dot.
      const exportImageData = toImageData(autoCropToSubject(finalImageData));
      const nukedPct = result.nukedPct;
      const totalTimeMs = result.durationMs;

      if (this.processingAborted) return;

      const blob = await exportPng(exportImageData);
      if (this.processingAborted) return;

      this.viewer.setResult(finalImageData, blob, {
        width: exportImageData.width,
        height: exportImageData.height,
      });
      await this.download.setResult(exportImageData, this.currentFileName, totalTimeMs, blob);
      if (this.processingAborted) return;

      // Show nuke percentage if background was removed
      if (nukedPct > 0) {
        this.progress.setStage('ml-segmentation', 'done', `${nukedPct}% nuked`);
      }

      this.lastResultImageData = finalImageData;

      this.setAdvancedBtnVisible(true);
    } catch (err) {
      if (this.processingAborted) return;
      // Abort is an expected outcome from "new image dropped" or
      // "batch aborted" — the new run that follows owns the UI from
      // there. Silent return. (The previous cmdbar Cancel button was
      // removed; user-initiated cancel is no longer a path here.)
      if (err instanceof PipelineAbortError) return;
      console.error('Pipeline error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.progress.setStage('ml-segmentation', 'error', t('pipeline.error', { msg }));
      this.updateCommandBarState('failed');
      this.showErrorModal(msg);
    } finally {
      this.progress.setRunning(false);
      if (!this.processingAborted) {
        this.isProcessing = false;
        this.enableWorkspaceButtons();
        this.updateCommandBarState('ready');
        // Notify the post-process CTA module so it can decide whether
        // to surface a star/tip/review ask. Light DOM listener — fires
        // and forgets, no return contract.
        emit(document, 'ar:nuke-success', undefined);
      }
    }
  }

  /**
   * Update the command-bar contents (#71). Called when a new image
   * lands in the workspace. The `state` drives the visible dot + label
   * and whether the Cancel button is exposed.
   */
  private updateCommandBar(payload: {
    filename: string;
    width: number;
    height: number;
    sizeBytes: number;
    state: 'running' | 'ready' | 'failed';
  }): void {
    const root = this.shadowRoot!;
    const fn = root.querySelector('#cmd-filename');
    if (fn) fn.textContent = payload.filename;
    const meta = root.querySelector('#cmd-meta');
    if (meta) {
      const kb = payload.sizeBytes > 0 ? ` · ${this.formatBytes(payload.sizeBytes)}` : '';
      meta.textContent = ` · ${payload.width}×${payload.height}${kb}`;
    }
    this.updateCommandBarState(payload.state);
  }

  private updateCommandBarState(state: 'running' | 'ready' | 'failed'): void {
    const root = this.shadowRoot!;
    const stateEl = root.querySelector('#cmd-state') as HTMLElement | null;
    const label = root.querySelector('#cmd-state-label');
    if (!stateEl || !label) return;
    stateEl.hidden = false;
    stateEl.setAttribute('data-state', state);
    const key =
      state === 'running' ? 'cmdbar.running' : state === 'ready' ? 'cmdbar.ready' : 'cmdbar.failed';
    label.textContent = t(key);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  /**
   * Show the error modal with the given message. Retry is only
   * meaningful if we still have the source image buffers — otherwise
   * the button hides itself and the user can only dismiss.
   */
  private showErrorModal(msg: string): void {
    const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
    const messageEl = this.shadowRoot?.querySelector('#error-modal-message');
    const retryBtn = this.shadowRoot?.querySelector(
      '#error-modal-retry',
    ) as HTMLButtonElement | null;
    if (!modal || !messageEl) return;
    messageEl.textContent = msg;
    const canRetry = !!(this.currentImageData && this.currentOriginalImageData);
    if (retryBtn) retryBtn.hidden = !canRetry;
    modal.hidden = false;
    // Shift focus to the primary action so keyboard users can act
    // without hunting for the dialog.
    queueMicrotask(() => {
      (canRetry
        ? retryBtn
        : (this.shadowRoot?.querySelector('#error-modal-dismiss') as HTMLElement | null)
      )?.focus();
    });
  }

  private hideErrorModal(): void {
    const modal = this.shadowRoot?.querySelector('#error-modal') as HTMLElement | null;
    if (modal) modal.hidden = true;
  }

  private retryFromError(): void {
    if (!this.currentImageData || !this.currentOriginalImageData) {
      this.hideErrorModal();
      return;
    }
    this.hideErrorModal();
    // Re-run processing with the same inputs. processImage() already
    // handles the state reset (progress, viewer, abort controller, etc).
    this.processImage(this.currentImageData, this.currentOriginalImageData, this.currentFileSize);
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
    this.batch.setMode(mode);
  }

  private async openBatchDetail(id: string): Promise<void> {
    const item = this.batch.findItem(id);
    if (!item) return;
    this.batch.setDetailId(id);

    const failedBar = this.shadowRoot!.querySelector('#batch-failed-bar') as HTMLElement;
    const retryBtn = this.shadowRoot!.querySelector('#batch-retry-btn') as HTMLElement;
    this.setBatchUiMode('detail');

    if (item.state === 'processing') {
      // Live progress view: show the original, let the pipeline callback
      // keep updating the progress console, hide result-only actions.
      failedBar.style.display = 'none';
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'running',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      this.download.reset();
      this.setAdvancedBtnVisible(false);
      return;
    }

    if (item.state === 'failed') {
      failedBar.style.display = 'flex';
      if (retryBtn) retryBtn.style.display = 'inline-block';
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'failed',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      this.download.reset();
      // Replay captured history so the console shows the real sequence
      // (e.g. detect-bg done → watermark-scan done → ml-segmentation error).
      // Fallback for edge cases where nothing was captured: synthesize a
      // single error stage so the user still sees what went wrong.
      if (item.stageHistory.length > 0) {
        this.batch.replayStageHistory(item.stageHistory);
      } else {
        this.progress.reset();
        this.progress.setStage(
          'ml-segmentation',
          'error',
          t('pipeline.error', { msg: item.errorMessage || 'Unknown error' }),
        );
      }
      this.setAdvancedBtnVisible(false);
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
      this.updateCommandBar({
        filename: item.originalName,
        width: item.originalImageData.width,
        height: item.originalImageData.height,
        sizeBytes: item.file.size,
        state: 'ready',
      });
      this.viewer.clearResult();
      this.viewer.setOriginal(item.originalImageData, item.file.size);
      // Replay per-item stage history so each finished image shows its own
      // icons (done/skipped) and timings — previously we just reset(),
      // which left every stage 'pending' and blanked out every icon.
      this.batch.replayStageHistory(item.stageHistory);
      this.download.reset();
      const finalImageData = item.finalImageData ?? toImageData(item.result.output);
      // Mirror the single-image flow: slider gets full-size; download
      // and the resolution label get the cropped subject bbox.
      const exportImageData =
        item.exportImageData ?? toImageData(autoCropToSubject(finalImageData));
      const blob = await exportPng(exportImageData);
      this.viewer.setResult(finalImageData, blob, {
        width: exportImageData.width,
        height: exportImageData.height,
      });
      await this.download.setResult(
        exportImageData,
        item.originalName,
        item.result.durationMs,
        blob,
      );
      this.lastResultImageData = finalImageData;
      this.setAdvancedBtnVisible(true);
    }
  }

  private closeBatchDetail(): void {
    this.batch.setDetailId(null);
    this.lastResultImageData = null;
    this.currentImageData = null;
    this.currentOriginalImageData = null;
    this.setAdvancedBtnVisible(false);
    const adv = this.shadowRoot!.querySelector('#editor-advanced') as HTMLElement | null;
    adv?.removeAttribute('active');
    this.setEditorOpen(false);
    this.setBatchUiMode('grid');
  }

  private async retryBatchItem(): Promise<void> {
    const id = this.batch.getDetailId();
    if (!id) return;
    this.closeBatchDetail();
    await this.batch.retry(id);
  }

  private discardBatchItem(): void {
    const id = this.batch.getDetailId();
    if (!id) return;
    this.batch.markDiscarded(id);
    this.closeBatchDetail();
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

    // Same guard as processImage(): returning to the landing must not
    // leave an editor open behind the hero.
    this.closeAdvancedEditor();

    workspace.classList.remove('visible');
    hero.classList.remove('hidden');
    if (dropzone) dropzone.style.display = '';
    if (grid) grid.style.display = 'none';
    if (single) single.style.display = 'flex';
    if (detailBar) detailBar.style.display = 'none';
    if (failedBar) failedBar.style.display = 'none';

    this.download.reset();
    this.lastResultImageData = null;
    this.currentImageData = null;
    this.currentOriginalImageData = null;

    if (this.batch.isInBatchMode()) {
      this.batch.abort();
      // Stop the in-flight pipeline run too — otherwise workers keep
      // processing the current item until its natural stage boundary.
      this.processingAbortController?.abort('batch aborted');
      this.batch.reset();
    }
    // Keep pipeline alive for next image (model stays loaded)
  }
}

customElements.define('ar-app', ArApp);
