import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { env, pipeline, RawImage } from '@huggingface/transformers';
import type { ImageDataLike, RmbgRefineOptions, RmbgRunner } from 'nukebg-core';
import {
  PipelineAbortError,
  RmbgError,
  RMBG_PARAMS,
  refineMask,
  resampleMask,
} from 'nukebg-core';
import { resolveCacheDir } from './cache-dir.js';

// Re-exported for backward compatibility — callers/tests importing
// `resolveCacheDir` from this module keep working after the hoist to
// `cache-dir.ts` (shared by `OnnxNodeLamaRunner`).
export { resolveCacheDir };

// ---------------------------------------------------------------------------
// Model integrity check (design §I.3)
// ---------------------------------------------------------------------------

/**
 * transformers.js v3's `FileCache` stores a pinned (non-"main") revision
 * under `<cacheDir>/<modelId>/<revision>/<filename>` (see
 * `@huggingface/transformers/src/utils/hub.js`, `tryCache`/cache-key
 * construction). The `q8` dtype maps to the `_quantized` filename suffix
 * (`@huggingface/transformers/src/utils/dtypes.js`), matching
 * `RMBG_PARAMS.MODEL_URL`'s `onnx/model_quantized.onnx`. This path is
 * therefore deterministic for the pinned revision we use — NOT a guess.
 */
function resolveModelCachePath(cacheDir: string): string {
  return join(cacheDir, 'briaai', 'RMBG-1.4', RMBG_PARAMS.REVISION, 'onnx', 'model_quantized.onnx');
}

/**
 * Post-download integrity check (design §I.3). Reads the cached ONNX file
 * from disk and compares its SHA-256 against the audited hash pinned in
 * `RMBG_PARAMS.EXPECTED_SHA256`.
 *
 * On mismatch the corrupted cache file is EVICTED (best-effort unlink,
 * swallowing ENOENT) BEFORE throwing — mirroring the browser worker's
 * `cache.delete(...)`-before-throw in `ml.worker.ts` — so a fresh CLI run
 * re-fetches clean bytes instead of bricking every future run on the same
 * poisoned file.
 *
 * Fallback (documented gap, design §I.3): if the file cannot be found at
 * the expected path — e.g. a future `@huggingface/transformers` release
 * changes its on-disk cache layout — the check is skipped silently rather
 * than blocking a working install, mirroring the browser worker's
 * best-effort behavior in `ml.worker.ts`'s `verifyRmbgIntegrity`. The
 * `readFileImpl`/`unlinkImpl` seams exist so this failure path (and the
 * mismatch/eviction path) are unit-testable without a real download.
 */
async function verifyModelIntegrity(
  cacheDir: string,
  readFileImpl: (path: string) => Promise<Buffer> = readFile,
  unlinkImpl: (path: string) => Promise<void> = unlink,
): Promise<void> {
  const modelPath = resolveModelCachePath(cacheDir);
  let buffer: Buffer;
  try {
    buffer = await readFileImpl(modelPath);
  } catch {
    return;
  }

  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== RMBG_PARAMS.EXPECTED_SHA256) {
    // Evict the poisoned cache entry before failing so the next run re-fetches
    // clean bytes (best-effort — swallow ENOENT / already-deleted).
    try {
      await unlinkImpl(modelPath);
    } catch {
      // ignore — file may already be gone
    }
    throw new RmbgError(
      `RMBG-1.4 hash mismatch: got ${digest}, expected ${RMBG_PARAMS.EXPECTED_SHA256}`,
      { code: 'RMBG_INTEGRITY_FAILED' },
    );
  }
}

// ---------------------------------------------------------------------------
// OnnxNodeRmbgRunner
// ---------------------------------------------------------------------------

interface SegmentationResult {
  mask?: { data: Uint8Array; width: number; height: number };
}
type SegmenterFn = (
  image: unknown,
  opts: { threshold: number; return_mask: boolean },
) => Promise<SegmentationResult[]>;

/** transformers.js pipelines expose an async `dispose()` that frees the
 * underlying native ORT session. Typed structurally so we can dispose an
 * orphaned load without widening the `SegmenterFn` call signature. */
type Disposable = { dispose?: () => void | Promise<void> };

async function disposeQuietly(seg: unknown): Promise<void> {
  const d = (seg as Disposable | null)?.dispose;
  if (typeof d === 'function') {
    try {
      await d.call(seg);
    } catch {
      // ignore dispose errors
    }
  }
}

/**
 * Node-only implementation of the `RmbgRunner` interface, backed by
 * `@huggingface/transformers`' Node pipeline (which in turn drives
 * `onnxruntime-node`). Mirrors the browser `ml.worker.ts` config but runs
 * in-process instead of in a Worker.
 */
export class OnnxNodeRmbgRunner implements RmbgRunner {
  private readonly cacheDir: string;
  private segmenter: SegmenterFn | null = null;
  private loadPromise: Promise<SegmenterFn> | null = null;
  private readonly readFileImpl: ((path: string) => Promise<Buffer>) | undefined;
  private readonly unlinkImpl: ((path: string) => Promise<void>) | undefined;

  constructor(opts?: {
    cacheDir?: string;
    readFileImpl?: (path: string) => Promise<Buffer>;
    unlinkImpl?: (path: string) => Promise<void>;
  }) {
    this.cacheDir = resolveCacheDir(opts?.cacheDir);
    this.readFileImpl = opts?.readFileImpl;
    this.unlinkImpl = opts?.unlinkImpl;
  }

  async load(opts?: { signal?: AbortSignal }): Promise<void> {
    if (opts?.signal?.aborted) {
      throw new PipelineAbortError('aborted before RMBG model load');
    }
    await this.ensureSegmenter(undefined, opts?.signal);
  }

  async segment(
    input: ImageDataLike,
    opts: {
      threshold: number;
      refine: RmbgRefineOptions;
      signal?: AbortSignal;
      onProgress?: (pct: number) => void;
    },
  ): Promise<Uint8Array> {
    if (opts.signal?.aborted) {
      throw new PipelineAbortError('aborted before RMBG segmentation');
    }

    const segmenter = await this.ensureSegmenter(opts.onProgress, opts.signal);

    if (opts.signal?.aborted) {
      throw new PipelineAbortError('aborted before RMBG segmentation');
    }

    const raw = new RawImage(input.data, input.width, input.height, 4);

    let results: SegmentationResult[];
    try {
      results = await segmenter(raw, { threshold: opts.threshold, return_mask: true });
    } catch (cause) {
      throw new RmbgError('RMBG-1.4 segmentation failed', { cause });
    }

    const mask = results[0]?.mask;
    if (!mask) {
      throw new RmbgError('RMBG-1.4 returned no mask');
    }

    // Shared resampler (core `resampleMask`, pixel-center offset) — single
    // source of truth matching the browser `ml.worker.ts` resize.
    const resampled = resampleMask(
      mask.data,
      mask.width,
      mask.height,
      input.width,
      input.height,
    );

    // Apply the same refinement chain the browser runs on every segmentation
    // (spatial passes -> morphological opening -> small-cluster removal).
    // This used to be skipped entirely: `opts.refine` was accepted and
    // dropped, so `--precision` only moved `rmbgThreshold` and CLI output
    // kept the speckle noise and false-positive clusters the web app removes
    // (issue #327).
    return refineMask(resampled, input.width, input.height, opts.refine);
  }

  async dispose(): Promise<void> {
    await disposeQuietly(this.segmenter);
    this.segmenter = null;
    this.loadPromise = null;
  }

  private async ensureSegmenter(
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<SegmenterFn> {
    if (this.segmenter) return this.segmenter;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      env.cacheDir = this.cacheDir;
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
      env.useFSCache = true;

      let seg: unknown;
      try {
        // Residual abort gap (design §I.3): `@huggingface/transformers`'
        // `pipeline()` does not accept an `AbortSignal`, so an in-flight
        // model download cannot be cancelled mid-stream here. We re-check
        // `signal.aborted` immediately after it resolves (below) and before
        // any heavy work, which bounds the wasted work to the download that
        // was already running. A future transformers API that threads a
        // signal should be wired through here.
        seg = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
          dtype: 'q8',
          revision: RMBG_PARAMS.REVISION,
          device: 'cpu',
          progress_callback: (progress) => {
            if (progress.status === 'progress') onProgress?.(Math.round(progress.progress));
          },
        });
      } catch (cause) {
        // An in-flight abort must still propagate as PipelineAbortError, not be
        // misclassified as a download failure.
        if (cause instanceof PipelineAbortError) throw cause;
        if (signal?.aborted) {
          throw new PipelineAbortError('aborted during RMBG model load');
        }
        // `pipeline()` performs the model download + native session load in one
        // step. A load/download/network failure here maps to
        // RMBG_DOWNLOAD_FAILED (REQ-CORE-RUNNERS-1's "model download fails"
        // scenario) — mirroring the LaMa runner's LAMA_DOWNLOAD_FAILED.
        throw new RmbgError('Failed to load RMBG-1.4 model', {
          code: 'RMBG_DOWNLOAD_FAILED',
          cause,
        });
      }

      // `pipeline()` fully loads the native ORT session above. Any throw AFTER
      // this point (abort re-check, integrity failure) would orphan that
      // native session — `dispose()` only frees `this.segmenter`, which is
      // still null here — so we dispose `seg` on every throw path before
      // rethrowing to avoid a native-memory leak.
      try {
        if (signal?.aborted) {
          throw new PipelineAbortError('aborted after RMBG model load');
        }

        await verifyModelIntegrity(this.cacheDir, this.readFileImpl, this.unlinkImpl);
      } catch (err) {
        await disposeQuietly(seg);
        throw err;
      }

      this.segmenter = seg as SegmenterFn;
      return this.segmenter;
    })();

    return this.loadPromise;
  }
}
