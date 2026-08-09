import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import type { ImageDataLike, LamaRunner } from 'nukebg-core';
import {
  LamaError,
  PipelineAbortError,
  LAMA_PARAMS,
  bilinearResizeRGBA,
  computeLamaCropRect,
  nearestResizeMask,
  spliceLamaOutput,
  packRgbaToChw,
  packMaskToChw,
  unpackChwToRgba,
} from 'nukebg-core';
import { resolveCacheDir } from './cache-dir.js';

// ---------------------------------------------------------------------------
// OnnxNodeLamaRunner
// ---------------------------------------------------------------------------
//
// Node-only implementation of the `LamaRunner` interface, backed directly
// by `onnxruntime-node` (design §I.2 — unlike RMBG there is no
// `@huggingface/transformers` abstraction for this model). Loading logic
// mirrors `onnx-node-rmbg.ts`'s injectable-seam pattern for testability:
// `readFileImpl`/`writeFileImpl`/`mkdirImpl`/`unlinkImpl`/`fetchImpl` seams
// let the cache-hit, cache-miss, download-failure, hash-mismatch, and
// corrupted-cache-eviction paths be unit-tested without touching the real
// filesystem or network, and without ever downloading the real ~90MB model.
//
// Tensor pre/post-processing constructs `ort.Tensor` HERE (design §I.2 — the
// `ort.Tensor` constructor is package-specific), but the pure packing math
// (`packRgbaToChw`/`packMaskToChw`/`unpackChwToRgba`) and the resize/crop
// math (`computeLamaCropRect`, `bilinearResizeRGBA`, `nearestResizeMask`,
// `spliceLamaOutput`) are imported from `nukebg-core`, mirroring the
// browser's `lama.worker.ts`.

interface OnnxNodeLamaRunnerOpts {
  cacheDir?: string;
  readFileImpl?: (path: string) => Promise<Buffer>;
  writeFileImpl?: (path: string, data: Uint8Array) => Promise<void>;
  mkdirImpl?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  unlinkImpl?: (path: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  /**
   * SHA-256 hex digest of a buffer. Defaults to the real
   * `node:crypto` implementation. Injectable purely for testability — a
   * real ~90MB model preimage matching `LAMA_PARAMS.EXPECTED_SHA256`
   * cannot be forged in a unit test, so tests exercising the post-hash
   * success path (`inpaint`'s tensor pack/unpack) override this to force
   * a deterministic match without weakening the production check.
   */
  hashImpl?: (buffer: Buffer) => string;
}

export class OnnxNodeLamaRunner implements LamaRunner {
  private readonly cacheDir: string;
  private session: ort.InferenceSession | null = null;
  private loadPromise: Promise<ort.InferenceSession> | null = null;
  private readonly readFileImpl: (path: string) => Promise<Buffer>;
  private readonly writeFileImpl: (path: string, data: Uint8Array) => Promise<void>;
  private readonly mkdirImpl: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  private readonly unlinkImpl: (path: string) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly hashImpl: (buffer: Buffer) => string;

  constructor(opts?: OnnxNodeLamaRunnerOpts) {
    this.cacheDir = resolveCacheDir(opts?.cacheDir);
    this.readFileImpl = opts?.readFileImpl ?? readFile;
    this.writeFileImpl = opts?.writeFileImpl ?? writeFile;
    this.mkdirImpl = opts?.mkdirImpl ?? mkdir;
    this.unlinkImpl = opts?.unlinkImpl ?? unlink;
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.hashImpl = opts?.hashImpl ?? ((buffer) => createHash('sha256').update(buffer).digest('hex'));
  }

  async load(loadOpts?: { signal?: AbortSignal }): Promise<void> {
    if (loadOpts?.signal?.aborted) {
      throw new PipelineAbortError('aborted before LaMa model load');
    }
    await this.ensureSession(loadOpts?.signal);
  }

  async inpaint(
    input: ImageDataLike,
    mask: Uint8Array,
    opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void },
  ): Promise<Uint8ClampedArray> {
    if (opts?.signal?.aborted) {
      throw new PipelineAbortError('aborted before LaMa inpainting');
    }

    const pixels =
      input.data instanceof Uint8ClampedArray ? input.data : new Uint8ClampedArray(input.data);

    const rect = computeLamaCropRect(mask, input.width, input.height);
    if (!rect) {
      // Empty mask — nothing to reconstruct. Mirrors the browser worker's
      // behavior: return the input unchanged.
      return new Uint8ClampedArray(pixels);
    }

    const session = await this.ensureSession(opts?.signal);

    if (opts?.signal?.aborted) {
      throw new PipelineAbortError('aborted before LaMa inpainting');
    }

    opts?.onProgress?.(0);

    const inputSize = LAMA_PARAMS.INPUT_SIZE;
    const cropRgba = bilinearResizeRGBA(pixels, input.width, rect, inputSize);
    const cropMask = nearestResizeMask(mask, input.width, rect, inputSize);

    const imageTensor = new ort.Tensor(
      'float32',
      packRgbaToChw(cropRgba, inputSize, inputSize),
      [1, 3, inputSize, inputSize],
    );
    const maskTensor = new ort.Tensor(
      'float32',
      packMaskToChw(cropMask, inputSize, inputSize),
      [1, 1, inputSize, inputSize],
    );

    let results: Awaited<ReturnType<ort.InferenceSession['run']>>;
    try {
      results = await session.run({
        [LAMA_PARAMS.IMAGE_INPUT_NAME]: imageTensor,
        [LAMA_PARAMS.MASK_INPUT_NAME]: maskTensor,
      });
    } catch (cause) {
      throw new LamaError('LaMa inference failed', { cause });
    }

    const outputName = session.outputNames[0];
    const outputTensor = outputName ? results[outputName] : undefined;
    if (!outputTensor) {
      throw new LamaError('LaMa returned no output tensor');
    }

    opts?.onProgress?.(100);

    const inpaintedCropRgba = unpackChwToRgba(
      outputTensor.data as Float32Array,
      inputSize,
      inputSize,
    );
    return spliceLamaOutput(pixels, input.width, input.height, inpaintedCropRgba, inputSize, rect);
  }

  async dispose(): Promise<void> {
    if (this.session) {
      try {
        await this.session.release();
      } catch {
        // Some ORT builds throw on release — ignore, we drop the ref below.
      }
    }
    this.session = null;
    this.loadPromise = null;
  }

  private async ensureSession(signal?: AbortSignal): Promise<ort.InferenceSession> {
    if (this.session) return this.session;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const cachePath = join(this.cacheDir, 'lama-fp32.onnx');
      const buffer = await this.loadVerifiedBuffer(cachePath, signal);

      let created: ort.InferenceSession;
      try {
        created = await ort.InferenceSession.create(buffer, {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
          logSeverityLevel: 3,
        });
      } catch (cause) {
        throw new LamaError('Failed to create LaMa inference session', { cause });
      }

      this.session = created;
      return created;
    })();

    return this.loadPromise;
  }

  /**
   * Return LaMa model bytes whose SHA-256 matches the audited hash. Cache-hit
   * bytes are hash-checked; a corrupted cache entry is EVICTED (best-effort
   * unlink) and re-downloaded rather than bricking every future run. The
   * download path verifies the hash BEFORE persisting, so a corrupt-but-
   * right-size body is never written to cache.
   */
  private async loadVerifiedBuffer(cachePath: string, signal?: AbortSignal): Promise<Buffer> {
    let cached: Buffer | null;
    try {
      cached = await this.readFileImpl(cachePath);
    } catch {
      cached = null;
    }

    if (cached) {
      const digest = this.hashImpl(cached);
      if (digest === LAMA_PARAMS.EXPECTED_SHA256) return cached;
      // Corrupted cache entry — evict it (best-effort, swallow ENOENT) so the
      // download below can persist clean bytes instead of throwing forever.
      try {
        await this.unlinkImpl(cachePath);
      } catch {
        // ignore — file may already be gone
      }
    }

    return this.downloadModel(cachePath, signal);
  }

  private async downloadModel(cachePath: string, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) {
      throw new PipelineAbortError('aborted before LaMa model download');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        LAMA_PARAMS.MODEL_URL,
        signal ? { signal } : {},
      );
    } catch (cause) {
      if (signal?.aborted) {
        throw new PipelineAbortError('aborted during LaMa model download');
      }
      throw new LamaError('Failed to fetch LaMa model', { code: 'LAMA_DOWNLOAD_FAILED', cause });
    }
    if (signal?.aborted) {
      throw new PipelineAbortError('aborted during LaMa model download');
    }
    if (!response.ok) {
      throw new LamaError(`Failed to fetch LaMa model: HTTP ${response.status}`, {
        code: 'LAMA_DOWNLOAD_FAILED',
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    if (signal?.aborted) {
      throw new PipelineAbortError('aborted during LaMa model download');
    }
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength !== LAMA_PARAMS.EXPECTED_SIZE) {
      throw new LamaError(
        `LaMa model size mismatch: got ${buffer.byteLength} bytes, expected ${LAMA_PARAMS.EXPECTED_SIZE}`,
        { code: 'LAMA_DOWNLOAD_FAILED' },
      );
    }

    // Verify integrity BEFORE persisting — a corrupt-but-right-size body must
    // never poison the cache (it would brick every future run). On mismatch
    // we throw without writing, so the next run re-downloads clean bytes.
    const digest = this.hashImpl(buffer);
    if (digest !== LAMA_PARAMS.EXPECTED_SHA256) {
      throw new LamaError(
        `LaMa model hash mismatch: got ${digest}, expected ${LAMA_PARAMS.EXPECTED_SHA256}`,
        { code: 'LAMA_INTEGRITY_FAILED' },
      );
    }

    await this.mkdirImpl(this.cacheDir, { recursive: true });
    await this.writeFileImpl(cachePath, buffer);
    return buffer;
  }
}
