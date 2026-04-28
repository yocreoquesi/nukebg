/**
 * MobileSAM lifecycle wrapper for the advanced editor:
 *   - Lazy-loads the model on first encode (~45MB download, one-time).
 *   - Caches the encoded image embedding in the worker; re-decodes are
 *     fast (no re-encode).
 *   - Tracks whether the current image is already encoded so callers
 *     don't need to manage the flag themselves.
 *   - Forwards the SAM worker's progress events to an optional callback.
 *
 * Extracted from `ar-editor-advanced.ts` in #47/Phase-3c. The component
 * used to carry a `samEncoded` boolean and inline `ensureSamEncoded()` /
 * `refineWithSam()` orchestration that mixed model loading, hint-DOM
 * updates, and lasso-mask blending. Pulling the model lifecycle into a
 * controller leaves the host with the UI + pixel composition only.
 *
 * The host instantiates one SamRefiner per component, wires a progress
 * callback that updates whatever UI element it cares about, and calls
 * `invalidate()` whenever the underlying image changes so the next
 * action triggers a fresh encode.
 */
import {
  loadSam,
  encodeSam,
  decodeSam,
  disposeSam,
  onSamProgress,
  type SamMaskResult,
} from '../refine/loaders/mobile-sam';

export type SamProgressCallback = (pct: number, stage: 'encoder' | 'decoder') => void;

export class SamRefiner {
  private encoded = false;

  constructor(private progressCb?: SamProgressCallback) {}

  /** Lazy-load the model and encode the given image. Idempotent — if
   *  the image is already encoded (no `invalidate()` since the last
   *  call), this returns immediately.
   *
   *  Throws `DOMException('Aborted', 'AbortError')` if `signal` fires
   *  before either of the two awaited stages completes. */
  async ensureEncoded(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.encoded) return;

    if (this.progressCb) onSamProgress(this.progressCb);

    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await loadSam();

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await encodeSam(pixels, width, height);

      this.encoded = true;
    } finally {
      // Always clear the progress wiring — leaking it across actions
      // would cause stale callbacks to fire on later encodes.
      if (this.progressCb) onSamProgress(null);
    }
  }

  /** Run the decoder on the cached embedding. Caller is responsible for
   *  having called `ensureEncoded()` first; calling `decode()` before
   *  the model is loaded throws. */
  async decode(
    points: Array<{ x: number; y: number }>,
    labels: number[],
    width: number,
    height: number,
  ): Promise<SamMaskResult> {
    if (!this.encoded) {
      throw new Error('SamRefiner: decode() called before ensureEncoded()');
    }
    return decodeSam(points, labels, width, height);
  }

  /** Whether the current image's embedding is cached. Resets to false
   *  on `invalidate()` and `dispose()`. */
  isEncoded(): boolean {
    return this.encoded;
  }

  /** Tell the controller the host loaded a new image. The next
   *  `ensureEncoded()` call will run a fresh load + encode. Cheaper
   *  than `dispose()` because the worker stays alive. */
  invalidate(): void {
    this.encoded = false;
  }

  /** Update the progress callback. Pass `null` to detach. The change
   *  takes effect on the next `ensureEncoded()` call (any in-flight
   *  encode keeps using the previous callback). */
  setProgressCallback(cb: SamProgressCallback | null): void {
    this.progressCb = cb ?? undefined;
  }

  /** Tear down the SAM worker and free its ONNX sessions. Call from
   *  the host's disconnectedCallback so the model doesn't leak across
   *  component instances. */
  dispose(): void {
    disposeSam();
    this.encoded = false;
  }
}
