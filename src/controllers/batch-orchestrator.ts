/**
 * Batch queue controller. Owns the multi-image processing state machine
 * (items, mode, detail-id, abort flag, currently-processing item) and the
 * per-item pipeline execution loop. Extracted from ar-app.ts in #47/Phase-1
 * so the host component shrinks toward pure orchestration + render.
 *
 * The host (ar-app) keeps:
 *   - The PipelineOrchestrator instance (single-image flow shares it)
 *   - The in-flight AbortController (cancel-processing handler must reach it
 *     on either path)
 *   - The detail-view rendering (it touches single-image fields + DOM
 *     templates that live in the host)
 *
 * The orchestrator never reaches into the host directly — it talks through
 * the BatchHost interface. The host passes itself in at construction.
 */
import { PipelineAbortError, type PipelineOrchestrator } from '../pipeline/orchestrator';
import type { PipelineStage, StageStatus } from '../types/pipeline';
import type { ModelId } from '../types/worker-messages';
import type { ArViewer } from '../components/ar-viewer';
import type { ArProgress } from '../components/ar-progress';
import type { ArDownload } from '../components/ar-download';
import type { ArBatchGrid } from '../components/ar-batch-grid';
import type { BatchItem, StageSnapshot } from '../types/batch';
import { createZip, safeZipEntryName, downloadBlob } from '../utils/zip';
import {
  dropOrphanBlobs,
  fillSubjectHoles,
  promoteSpeckleAlpha,
} from '../pipeline/finalize';
import { composeAtOriginal } from '../utils/final-composite';
import { exportPng } from '../utils/image-io';

export type BatchMode = 'off' | 'grid' | 'detail';

export type BatchStageCallback = (
  stage: PipelineStage,
  status: StageStatus,
  message?: string,
) => void;

/** UI components the orchestrator drives. Owned by host; orchestrator
 *  borrows references. */
export interface BatchUi {
  viewer: ArViewer;
  progress: ArProgress;
  download: ArDownload;
  batchGrid: ArBatchGrid | null;
}

/** Host-private capabilities the orchestrator needs to call into. */
export interface BatchHost {
  /** Install the per-batch stage callback onto the (lazy) pipeline and
   *  return the armed pipeline for `process()` calls. The host owns the
   *  lazy-creation logic so single-image flow can share the same instance. */
  installBatchStageCallback(cb: BatchStageCallback): PipelineOrchestrator;

  /** Set the AbortController for the in-flight item. Host stores it so the
   *  global `ar:cancel-processing` handler can abort either single-image
   *  or batch flows uniformly. */
  setProcessingAbortController(c: AbortController | null): void;

  /** Build a thumbnail data-URL. Host owns this because it uses a DOM
   *  canvas (orchestrator stays DOM-free except for borrowed components). */
  makeThumbnail(img: ImageData, maxSide?: number): string;

  /** Called once when `start()` flips the UI to grid mode — host swaps
   *  the hero/workspace DOM. Pure UI, no return value. */
  enterGridMode(): void;
}

export class BatchOrchestrator {
  private static readonly MODEL_ID: ModelId = 'briaai/RMBG-1.4';

  private items: BatchItem[] = [];
  private mode: BatchMode = 'off';
  private detailId: string | null = null;
  private aborted = false;
  private currentProcessingItem: BatchItem | null = null;

  /** Optional callback invoked when an item finishes processing AND
   *  it's the one currently shown in detail view. Host wires this so the
   *  detail UI auto-refreshes from "live" to "done"/"failed". */
  private onItemRefreshed?: (id: string) => Promise<void> | void;

  constructor(
    private ui: BatchUi,
    private host: BatchHost,
  ) {}

  // ── Accessors ──────────────────────────────────────────────────────

  getMode(): BatchMode {
    return this.mode;
  }

  isInBatchMode(): boolean {
    return this.mode !== 'off';
  }

  getDetailId(): string | null {
    return this.detailId;
  }

  findItem(id: string): BatchItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  // ── Mutators wired from host UI handlers ──────────────────────────

  setMode(mode: BatchMode): void {
    this.mode = mode;
  }

  setDetailId(id: string | null): void {
    this.detailId = id;
  }

  abort(): void {
    this.aborted = true;
  }

  setOnItemRefreshed(cb: (id: string) => Promise<void> | void): void {
    this.onItemRefreshed = cb;
  }

  // ── Public lifecycle ───────────────────────────────────────────────

  /** Initialize a new batch from dropped images and run the queue. */
  async start(
    images: Array<{
      file: File;
      imageData: ImageData;
      originalImageData: ImageData;
      originalWidth: number;
      originalHeight: number;
      wasDownsampled: boolean;
    }>,
  ): Promise<void> {
    this.aborted = false;
    this.items = images.map((img, i) => ({
      id: `batch-${Date.now()}-${i}`,
      originalName: img.file.name || `image-${i + 1}.png`,
      file: img.file,
      imageData: img.imageData,
      originalImageData: img.originalImageData ?? img.imageData,
      state: 'pending',
      result: null,
      finalImageData: null,
      thumbnailUrl: this.host.makeThumbnail(img.originalImageData ?? img.imageData),
      stageHistory: [],
    }));

    this.mode = 'grid';
    this.host.enterGridMode();

    if (this.ui.batchGrid) {
      this.ui.batchGrid.setItems(this.items);
      this.ui.batchGrid.setCurrentIndex(0);
    }

    await this.runQueue();
  }

  /** Run the queue until all items are done/failed/discarded. Re-entrant
   *  from retry flows — re-installs the stage callback each time so the
   *  pipeline records into the current batch's items. */
  async runQueue(): Promise<void> {
    const stageCallback: BatchStageCallback = (stage, status, message) => {
      this.ui.progress.setStage(stage, status, message);
      const current = this.currentProcessingItem;
      if (current) current.stageHistory.push({ stage, status, message });
    };
    const pipeline = this.host.installBatchStageCallback(stageCallback);

    for (let i = 0; i < this.items.length; i++) {
      if (this.aborted) return;
      const item = this.items[i];
      if (item.state === 'done' || item.state === 'discarded') continue;
      if (this.ui.batchGrid) this.ui.batchGrid.setCurrentIndex(i);
      item.state = 'processing';
      // Fresh slate for this item: empty history, empty live console.
      item.stageHistory = [];
      this.ui.progress.reset();
      this.ui.progress.setRunning(true);
      this.currentProcessingItem = item;
      if (this.ui.batchGrid) this.ui.batchGrid.updateItem(item.id, 'processing');
      // One signal per batch item so cancelling the batch aborts the
      // in-flight one promptly without waiting for the current stage.
      const ac = new AbortController();
      this.host.setProcessingAbortController(ac);
      try {
        const result = await pipeline.process(
          item.imageData,
          BatchOrchestrator.MODEL_ID,
          'high-power',
          ac.signal,
        );
        if (this.aborted) return;
        const composed = composeAtOriginal({
          originalRgba: item.originalImageData.data,
          originalWidth: item.originalImageData.width,
          originalHeight: item.originalImageData.height,
          workingRgba: result.workingPixels,
          workingWidth: result.workingWidth,
          workingHeight: result.workingHeight,
          workingAlpha: result.workingAlpha,
          inpaintMask: result.watermarkMask,
        });
        const finalImageData =
          result.contentType === 'PHOTO' || result.contentType === 'ILLUSTRATION'
            ? promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(composed)))
            : composed;
        item.result = result;
        item.finalImageData = finalImageData;
        item.thumbnailUrl = this.host.makeThumbnail(finalImageData);
        item.state = 'done';
        if (this.ui.batchGrid) this.ui.batchGrid.updateItem(item.id, 'done', item.thumbnailUrl);
        // Auto-refresh detail view if the user is currently watching this item.
        if (this.detailId === item.id && this.onItemRefreshed) {
          await this.onItemRefreshed(item.id);
        }
      } catch (err) {
        // Abort during batch = user cancelled. Don't mark the item as
        // failed; the outer abort check returns on next tick.
        if (err instanceof PipelineAbortError || this.aborted) {
          this.ui.progress.setRunning(false);
          return;
        }
        item.errorMessage = err instanceof Error ? err.message : String(err);
        item.state = 'failed';
        if (this.ui.batchGrid) this.ui.batchGrid.updateItem(item.id, 'failed');
        if (this.detailId === item.id && this.onItemRefreshed) {
          await this.onItemRefreshed(item.id);
        }
      }
    }
    this.ui.progress.setRunning(false);
    this.currentProcessingItem = null;
  }

  /** Mark a failed item as pending and re-run the queue. Host wires this
   *  to the retry button. Caller is expected to close detail view first. */
  async retry(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.state = 'pending';
    item.errorMessage = undefined;
    item.stageHistory = [];
    if (this.ui.batchGrid) this.ui.batchGrid.updateItem(item.id, 'pending');
    await this.runQueue();
  }

  /** Mark an item as discarded so it's excluded from the ZIP and the
   *  queue skips it on a re-run. */
  markDiscarded(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.state = 'discarded';
    if (this.ui.batchGrid) this.ui.batchGrid.updateItem(item.id, 'discarded');
  }

  /** Replay a finished item's captured stage events into the shared
   *  progress console. Resets first so no stale state from the previous
   *  item leaks through, then reapplies each snapshot in order. */
  replayStageHistory(history: StageSnapshot[]): void {
    this.ui.progress.reset();
    for (const snap of history) {
      this.ui.progress.setStage(snap.stage, snap.status, snap.message);
    }
  }

  /** ZIP the finished items and trigger a browser download. */
  async downloadZip(): Promise<void> {
    const done = this.items.filter((i) => i.state === 'done' && i.result);
    if (done.length === 0) return;
    const files = await Promise.all(
      done.map(async (item, idx) => ({
        name: safeZipEntryName(idx + 1, done.length, item.originalName),
        blob: await exportPng(item.finalImageData ?? item.result!.imageData),
      })),
    );
    const zip = await createZip(files);
    downloadBlob(zip, `nukebg-batch-${Date.now()}.zip`);
  }

  /** Wipe queue state. Called from host's resetToIdle when the user
   *  hits "back" on a running/finished batch. */
  reset(): void {
    this.items = [];
    this.detailId = null;
    this.mode = 'off';
    this.currentProcessingItem = null;
    // Keep `aborted = true` so any in-flight runQueue tick returns on
    // its next iteration; runQueue resets it at the next start().
  }
}
