/**
 * Shared ONNX Runtime Web session helper with WebGPU→WASM fallback.
 *
 * ORT is loaded from the pinned dep already in package.json (installed for LaMa).
 * Weights are fetched from a URL (typically HuggingFace) as ArrayBuffer so we
 * can report download progress to the UI later.
 */

import * as ort from 'onnxruntime-web/webgpu';

export interface OrtSessionResult {
  session: ort.InferenceSession;
  backend: 'webgpu' | 'wasm';
}

export interface SessionOptions {
  /** Absolute URL to the .onnx file. */
  url: string;
  /** Prefer WebGPU when available; fall back to WASM if it errors on session create. */
  preferWebGpu?: boolean;
  /** Progress callback (0..1) during weight download. */
  onProgress?: (ratio: number) => void;
}

async function fetchWithProgress(
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ORT fetch failed: ${res.status} ${res.statusText} (${url})`);
  if (!onProgress || !res.body) return res.arrayBuffer();

  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(received / total);
  }
  const blob = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    blob.set(c, offset);
    offset += c.length;
  }
  return blob.buffer;
}

export async function createOrtSession(opts: SessionOptions): Promise<OrtSessionResult> {
  const bytes = await fetchWithProgress(opts.url, opts.onProgress);

  const providers: ('webgpu' | 'wasm')[] = opts.preferWebGpu !== false
    ? ['webgpu', 'wasm']
    : ['wasm'];

  for (const provider of providers) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: [provider],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3,
      });
      return { session, backend: provider };
    } catch (err) {
      if (provider === providers[providers.length - 1]) throw err;
    }
  }
  throw new Error('createOrtSession: no execution provider succeeded');
}
