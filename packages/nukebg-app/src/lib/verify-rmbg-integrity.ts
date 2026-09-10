import { RMBG_PARAMS } from 'nukebg-core';

/**
 * Supply-chain integrity check for the RMBG-1.4 weights.
 *
 * Lifted out of `ml.worker.ts` in #397 so both download paths can use it.
 * It had lived inside the worker, which meant the worker verified its
 * download and `refine/loaders/rmbg14.ts` — reached from the advanced
 * editor's Reprocess / Crop / Refine buttons — verified nothing, while the
 * surrounding code read as though the model was checked everywhere. Nothing
 * here was ever worker-specific: `caches` and `crypto.subtle` exist on the
 * main thread too, so the split was accidental rather than designed.
 *
 * Call it AFTER `transformers.pipeline()` resolves — by then the quantized
 * ONNX lives in the standard browser Cache API (`transformers-cache`) — and
 * BEFORE exposing the pipeline to inference. On mismatch it evicts the
 * cache entry and throws, so the caller must not retain the pipeline it
 * just built; the next load then re-fetches from upstream.
 *
 * Verification is best-effort and never blocks a working install: it skips
 * silently when the Cache API is unavailable (http context, cross-origin
 * restrictions) or when the blob is not in the cache. That is deliberate —
 * a browser that cannot expose the cache is not evidence of tampering — but
 * it does mean a passing call is not proof the bytes were checked. Only a
 * throw is proof they were checked and failed.
 */
export async function verifyRmbgIntegrity(modelId: string): Promise<void> {
  if (modelId !== 'briaai/RMBG-1.4') return;
  if (typeof caches === 'undefined') return;

  let cache: Cache;
  try {
    cache = await caches.open(RMBG_PARAMS.CACHE_NAME);
  } catch {
    return;
  }

  const resp = await cache.match(RMBG_PARAMS.MODEL_URL);
  if (!resp) {
    console.warn(
      '[NukeBG ML] Model blob not found in transformers cache — integrity check skipped.',
    );
    return;
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength !== RMBG_PARAMS.EXPECTED_SIZE) {
    await cache.delete(RMBG_PARAMS.MODEL_URL);
    throw new Error(
      `RMBG-1.4 model size mismatch: got ${buf.byteLength} bytes, expected ` +
        `${RMBG_PARAMS.EXPECTED_SIZE}. Cache evicted; reload to re-fetch.`,
    );
  }

  const digestBuf = await crypto.subtle.digest('SHA-256', buf);
  const digestHex = Array.from(new Uint8Array(digestBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (digestHex !== RMBG_PARAMS.EXPECTED_SHA256) {
    await cache.delete(RMBG_PARAMS.MODEL_URL);
    throw new Error(
      `RMBG-1.4 hash mismatch: got ${digestHex}, expected ${RMBG_PARAMS.EXPECTED_SHA256}. ` +
        `Cache evicted; reload to re-fetch.`,
    );
  }
}
