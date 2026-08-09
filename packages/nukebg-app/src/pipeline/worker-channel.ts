/**
 * WorkerChannel — request/response plumbing for a single Web Worker.
 *
 * Owns the request lifecycle (UUID, pendingRequests map, pendingTimers
 * watchdog set, transferable extraction, response routing) so the
 * orchestrator becomes pure domain logic. Every worker boundary in the
 * pipeline (cv, ml, inpaint, lama) is one of these.
 *
 * The #44 leak fix lives here: `settlePending()` clears the watchdog
 * timer AND drops it from `pendingTimers` in one place, and every Call
 * path attaches the timer handle to the pending request so response
 * handlers can settle it promptly instead of waiting for the timer to
 * fire empty-handed.
 */

interface ResponseEnvelope {
  id?: string;
  type: string;
}

export type ClassifyResult =
  /** Settle the matching pending request as resolved with `value`. */
  | { kind: 'resolve'; value: unknown }
  /** Settle the matching pending request as rejected with `error`. */
  | { kind: 'reject'; error: string }
  /** Pending request exists but the message type doesn't match the
   *  expected type — log and ignore (do not settle). Used by ML to
   *  prevent a stray `model-ready` from resolving a `segment` request
   *  when the worker auto-loads the model. */
  | { kind: 'ignore'; reason?: string };

export interface WorkerChannelOptions<TMsg extends ResponseEnvelope> {
  /** Short name (e.g. 'CV', 'ML') used in timeout / crash error messages. */
  name: string;
  /** Per-call timeout in ms. */
  timeoutMs: number;
  /** Builds a fresh Worker instance. Called eagerly via `start()` or on
   *  `recreate()` after an abort. */
  factory: () => Worker;
  /** Pre-resolution intermediate messages (model download progress,
   *  warmup diagnostics, etc.) — return `true` so they bypass the
   *  pending-request map and reach `onProgress`. */
  isProgress: (msg: TMsg) => boolean;
  /** Forwarded for any message where `isProgress(msg) === true`. */
  onProgress?: (msg: TMsg) => void;
  /** Routes a final response to a settle decision. Receives the
   *  `expectedType` recorded when the original `call()` was made so the
   *  classifier can guard against type-mismatched responses. */
  resolveResponse: (msg: TMsg, expectedType: string) => ClassifyResult;
}

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
  expectedType: string;
  /** Watchdog timer handle, so response handlers can clear it promptly
   *  via `settlePending()` instead of waiting for it to fire empty-handed. */
  timer?: ReturnType<typeof setTimeout>;
}

/** Fallback UUID generator for browsers that don't support crypto.randomUUID (Safari <15.4) */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class WorkerChannel<TMsg extends ResponseEnvelope = ResponseEnvelope> {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly opts: WorkerChannelOptions<TMsg>) {}

  /** Eagerly create the worker. For lazy channels (inpaint, lama) skip
   *  this and let `call()` materialize on first use. */
  start(): void {
    this.ensureWorker();
  }

  /** Whether the underlying worker currently exists. */
  get hasWorker(): boolean {
    return this.worker !== null;
  }

  /** Number of watchdog timers still armed. Test-only signal for the
   *  #44 leak regression guard. */
  get pendingTimersSize(): number {
    return this.pendingTimers.size;
  }

  /** Number of in-flight requests. Test-only signal for the #44 leak
   *  regression guard. */
  get pendingRequestsSize(): number {
    return this.pendingRequests.size;
  }

  /**
   * Send a typed request and await its response.
   *
   * `extra` lets the caller spread fields outside the `payload` envelope
   * (used by ML for `modelId`, `threshold`, `refine`). Transferables are
   * extracted from `payload` only — if `extra` carries buffers the caller
   * is responsible for transferring them itself (no current callers do).
   */
  call<T>(
    type: string,
    payload?: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = this.ensureWorker();
      const id = generateUUID();
      const transferables = extractTransferables(payload);
      worker.postMessage({ id, type, payload, ...extra }, transferables);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(`${this.opts.name} Worker timeout after ${this.opts.timeoutMs}ms: ${type}`),
          );
        }
      }, this.opts.timeoutMs);
      this.pendingTimers.add(timer);
      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        expectedType: type,
        timer,
      });
    });
  }

  /**
   * Settle a pending request (resolve or reject): clear its watchdog
   * timer, drop the timer from pendingTimers, and remove the entry from
   * pendingRequests. Call this from every response handler so the
   * pendingTimers set stays tight — without it, timers linger until
   * they fire empty-handed (#44 leak).
   */
  private settlePending(id: string): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
      this.pendingTimers.delete(pending.timer);
    }
    this.pendingRequests.delete(id);
  }

  /** Reject every in-flight request with `err` and clear all timers. The
   *  worker itself is left untouched — call `dispose()` or `recreate()`
   *  separately to tear it down. */
  rejectAllPending(err: Error): void {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const [, pending] of this.pendingRequests) {
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  /** Tear down the worker and recreate it. Pending requests should be
   *  rejected via `rejectAllPending()` first. */
  recreate(): void {
    this.dispose();
    this.ensureWorker();
  }

  /** Tear down the worker without recreating it. Used for lazy channels
   *  (inpaint, lama) that should be reborn on next `call()`. */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = this.opts.factory();
    w.onerror = (e) => {
      const err = new Error(`${this.opts.name} Worker error: ${e.message}`);
      this.rejectAllPending(err);
      // Drop the dead worker so the next call creates a fresh one. The
      // orchestrator is also responsible for any higher-level teardown
      // (e.g. recreate() on cv/ml after `abort()`).
      if (this.worker === w) {
        this.worker.terminate();
        this.worker = null;
      }
    };
    w.onmessage = (e: MessageEvent<TMsg>) => this.onMessage(e.data);
    this.worker = w;
    return w;
  }

  private onMessage(msg: TMsg): void {
    if (this.opts.isProgress(msg)) {
      this.opts.onProgress?.(msg);
      return;
    }
    if (!msg.id) return;
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    const result = this.opts.resolveResponse(msg, pending.expectedType);
    if (result.kind === 'ignore') {
      console.warn(
        `[NukeBG] ${msg.type} arrived for a '${pending.expectedType}' request - ignoring` +
          (result.reason ? ` (${result.reason})` : ''),
      );
      return;
    }
    this.settlePending(msg.id);
    if (result.kind === 'resolve') {
      pending.resolve(result.value);
    } else {
      pending.reject(new Error(result.error));
    }
  }
}

/** Extract Transferable buffers from a payload object. */
export function extractTransferables(payload: Record<string, unknown> | undefined): Transferable[] {
  if (!payload) return [];
  const transferables: Transferable[] = [];
  for (const val of Object.values(payload)) {
    if (val instanceof ArrayBuffer) {
      transferables.push(val);
    } else if (ArrayBuffer.isView(val) && val.buffer instanceof ArrayBuffer) {
      transferables.push(val.buffer);
    }
  }
  return transferables;
}
