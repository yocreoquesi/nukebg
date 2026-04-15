/**
 * LaMa inpaint loader for the lab — wraps the existing lama.worker.ts
 * behind a small promise-based API so UI components (advanced editor)
 * can inpaint a region without going through the full pipeline
 * orchestrator. The worker is a module-scoped singleton: first call
 * downloads the ONNX model (~95MB) and warms up; subsequent calls
 * reuse it.
 *
 * Contract:
 *   inpaintWithLama(pixels, width, height, mask) → reconstructed RGBA
 *   where `mask` is a Uint8Array the same size as width*height, 1 where
 *   we want LaMa to fill, 0 where to keep the original pixels.
 */

import type { LamaWorkerResponse } from '../../src/types/worker-messages';

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let progressHandler: ((progress: number, stage?: string) => void) | null = null;

export function onLamaProgress(cb: ((progress: number, stage?: string) => void) | null): void {
  progressHandler = cb;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    new URL('../../src/workers/lama.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('message', (e: MessageEvent<LamaWorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'lama-model-progress') {
      progressHandler?.(msg.progress, 'download');
    } else if (msg.type === 'lama-inpaint-progress') {
      progressHandler?.(100, msg.stage);
    }
  });
  return worker;
}

async function ensureLoaded(): Promise<void> {
  if (ready) return ready;
  const w = ensureWorker();
  ready = new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<LamaWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'lama-model-ready') {
        w.removeEventListener('message', handler);
        resolve();
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        ready = null;
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ id: 'lama-load', type: 'lama-load-model' });
  });
  return ready;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lama-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function inpaintWithLama(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): Promise<Uint8ClampedArray> {
  await ensureLoaded();
  const w = ensureWorker();
  const id = uuid();
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const handler = (e: MessageEvent<LamaWorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'lama-inpaint-result') {
        w.removeEventListener('message', handler);
        resolve(msg.result);
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      id,
      type: 'lama-inpaint',
      payload: { pixels, width, height, mask },
    });
  });
}

export function disposeLama(): void {
  if (!worker) return;
  try {
    worker.postMessage({ id: 'lama-dispose', type: 'lama-dispose' });
  } catch { /* noop */ }
  worker.terminate();
  worker = null;
  ready = null;
}
