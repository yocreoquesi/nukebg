/**
 * MobileSAM loader for the lab + advanced editor.
 *
 * Wraps the SAM Web Worker with a promise-based API:
 *   loadSam()     → downloads models (~45MB total), resolves on ready
 *   encodeSam()   → runs encoder on image, caches embeddings in worker
 *   decodeSam()   → runs decoder with point prompts, returns binary mask
 *   disposeSam()  → releases ONNX sessions + terminates worker
 *
 * Progress and errors are surfaced via an optional callback.
 */

import type { SamWorkerRequest, SamWorkerResponse } from '../../src/types/worker-messages';

type ProgressCb = (pct: number, stage: 'encoder' | 'decoder') => void;

let worker: Worker | null = null;
let reqId = 0;
let progressCb: ProgressCb | null = null;

const pending = new Map<
  string,
  {
    resolve: (value: SamWorkerResponse) => void;
    reject: (err: Error) => void;
  }
>();

function nextId(): string {
  return `sam-${++reqId}`;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../src/workers/sam.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (e: MessageEvent<SamWorkerResponse>) => {
    const msg = e.data;

    if (msg.type === 'sam-load-progress') {
      progressCb?.(msg.progress, msg.stage);
      return;
    }

    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);

    if (msg.type === 'error') {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg);
    }
  });
  return worker;
}

function send<T extends SamWorkerResponse>(req: SamWorkerRequest): Promise<T> {
  const w = ensureWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(req.id, {
      resolve: resolve as (v: SamWorkerResponse) => void,
      reject,
    });
    w.postMessage(req);
  });
}

export function onSamProgress(cb: ProgressCb | null): void {
  progressCb = cb;
}

export async function loadSam(): Promise<void> {
  const id = nextId();
  await send({ id, type: 'sam-load' });
}

export async function encodeSam(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<void> {
  const id = nextId();
  await send({ id, type: 'sam-encode', payload: { pixels, width, height } });
}

export interface SamMaskResult {
  mask: Uint8Array;
  width: number;
  height: number;
}

export async function decodeSam(
  points: Array<{ x: number; y: number }>,
  labels: number[],
  width: number,
  height: number,
): Promise<SamMaskResult> {
  const id = nextId();
  const resp = await send<Extract<SamWorkerResponse, { type: 'sam-mask' }>>({
    id,
    type: 'sam-decode',
    payload: { points, labels, width, height },
  });
  return { mask: resp.mask, width: resp.width, height: resp.height };
}

export function disposeSam(): void {
  if (!worker) return;
  const id = nextId();
  worker.postMessage({ id, type: 'sam-dispose' } satisfies SamWorkerRequest);
  worker.terminate();
  worker = null;
  pending.clear();
  progressCb = null;
}
