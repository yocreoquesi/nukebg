import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LamaError, PipelineAbortError } from 'nukebg-core';
import { LAMA_PARAMS } from 'nukebg-core';

// ---------------------------------------------------------------------------
// Mock onnxruntime-node — NEVER download the real ~200MB LaMa model in a
// test. `InferenceSession.create` resolves instantly with a fake session
// whose `run()` returns a deterministic output tensor.
// ---------------------------------------------------------------------------

const mockRun = vi.fn(async (_feeds: unknown) => ({
  output: { data: new Float32Array(3 * LAMA_PARAMS.INPUT_SIZE * LAMA_PARAMS.INPUT_SIZE), dims: [1, 3, LAMA_PARAMS.INPUT_SIZE, LAMA_PARAMS.INPUT_SIZE] },
}));
const mockSession = { run: mockRun, outputNames: ['output'], release: vi.fn(async () => undefined) };
const mockCreate = vi.fn(async (_buffer: unknown, _opts: unknown) => mockSession);

vi.mock('onnxruntime-node', () => {
  class MockTensor {
    type: string;
    data: unknown;
    dims: number[];
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }
  return {
    InferenceSession: { create: (...args: unknown[]) => mockCreate(...(args as [unknown, unknown])) },
    Tensor: MockTensor,
    env: {},
  };
});

// Import AFTER vi.mock so the mocked module is used.
const { OnnxNodeLamaRunner } = await import('../../src/runners/onnx-node-lama.js');

// A model buffer whose SHA-256 matches LAMA_PARAMS.EXPECTED_SHA256 is not
// feasible to construct in-memory for a unit test (it's the real ~90MB
// model). The runner exposes an injectable `hashImpl` seam so tests can
// force a deterministic match/mismatch without hashing ~90MB or forging a
// SHA-256 preimage. Production always uses the real `node:crypto` digest.

const EXPECTED = LAMA_PARAMS.EXPECTED_SHA256;

describe('OnnxNodeLamaRunner cache + download', () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockCreate.mockClear();
  });

  it('cache hit: reads from disk, skips download, and creates the session when the hash matches', async () => {
    const readFileImpl = vi.fn(async () => Buffer.from('cached-lama-bytes'));
    const fetchImpl = vi.fn();
    // Force a hash match on the cached bytes so the happy cache-hit path runs.
    const hashImpl = vi.fn(() => EXPECTED);

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-cache',
      readFileImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hashImpl,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    const result = await runner.inpaint(input, mask);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(readFileImpl).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('cache miss: fetches from LAMA_PARAMS.MODEL_URL, validates size, verifies hash, writes cache, creates session', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const writeFileImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const modelBytes = new Uint8Array(LAMA_PARAMS.EXPECTED_SIZE);
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(LAMA_PARAMS.MODEL_URL);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => modelBytes.buffer,
      } as unknown as Response;
    });
    // Fix #10: stub the hash so the size-validation + write path is exercised
    // WITHOUT running a real SHA-256 over the full ~92MB EXPECTED_SIZE buffer.
    const hashImpl = vi.fn(() => EXPECTED);

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-cache-miss',
      readFileImpl,
      writeFileImpl,
      mkdirImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hashImpl,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    const result = await runner.inpaint(input, mask);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(writeFileImpl).toHaveBeenCalledTimes(1);
    expect(mkdirImpl).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT write to cache when the downloaded body fails the hash (Fix #2: no cache poisoning)', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const writeFileImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const modelBytes = new Uint8Array(LAMA_PARAMS.EXPECTED_SIZE);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => modelBytes.buffer,
    }) as unknown as Response);
    // Right size, WRONG hash — a corrupt-but-right-size body.
    const hashImpl = vi.fn(() => 'deadbeef-not-the-expected-hash');

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-poison',
      readFileImpl,
      writeFileImpl,
      mkdirImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hashImpl,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    await expect(runner.inpaint(input, mask)).rejects.toSatisfy(
      (e: unknown) => e instanceof LamaError && (e as LamaError).code === 'LAMA_INTEGRITY_FAILED',
    );
    // The poisoned body must NEVER be persisted, and no session created.
    expect(writeFileImpl).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('evicts a corrupted cached file and re-downloads clean bytes (Fix #2: no permanent brick)', async () => {
    const badBytes = Buffer.from('corrupted-lama-model-bytes');
    const goodBytes = new Uint8Array(LAMA_PARAMS.EXPECTED_SIZE);
    const readFileImpl = vi.fn(async () => badBytes);
    const unlinkImpl = vi.fn(async () => undefined);
    const writeFileImpl = vi.fn(async () => undefined);
    const mkdirImpl = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => goodBytes.buffer,
    }) as unknown as Response);
    // Cached bad bytes -> mismatch; freshly downloaded good bytes -> match.
    const hashImpl = vi.fn((buf: Buffer) => (buf.byteLength === goodBytes.byteLength ? EXPECTED : 'bad'));

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-evict',
      readFileImpl,
      unlinkImpl,
      writeFileImpl,
      mkdirImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hashImpl,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    const result = await runner.inpaint(input, mask);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(unlinkImpl).toHaveBeenCalledTimes(1); // corrupted entry evicted
    expect(fetchImpl).toHaveBeenCalledTimes(1); // re-downloaded
    expect(writeFileImpl).toHaveBeenCalledTimes(1); // clean bytes persisted
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects with LamaError code LAMA_DOWNLOAD_FAILED on HTTP failure', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response);

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-http-fail',
      readFileImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    await expect(runner.inpaint(input, mask)).rejects.toSatisfy(
      (e: unknown) => e instanceof LamaError && (e as LamaError).code === 'LAMA_DOWNLOAD_FAILED',
    );
  });

  it('aborts mid-download and rejects with PipelineAbortError (Fix #6: signal threaded into fetch)', async () => {
    const readFileImpl = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const controller = new AbortController();
    const modelBytes = new Uint8Array(LAMA_PARAMS.EXPECTED_SIZE);
    // fetch observes the threaded signal and aborts mid-flight before the body
    // resolves — the runner must reject with PipelineAbortError, not proceed.
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => modelBytes.buffer,
      } as unknown as Response;
    });
    const writeFileImpl = vi.fn(async () => undefined);

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-abort',
      readFileImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      writeFileImpl,
    });

    const width = 4;
    const height = 4;
    const input = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    await expect(
      runner.inpaint(input, mask, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(PipelineAbortError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
    expect(writeFileImpl).not.toHaveBeenCalled();
  });
});

describe('OnnxNodeLamaRunner.inpaint', () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockCreate.mockClear();
  });

  it('returns a Uint8ClampedArray of length width * height * 4 matching input dimensions', async () => {
    const readFileImpl = vi.fn(async () => Buffer.from('cached-lama-bytes'));
    // Hashing a real ~90MB model to a known preimage isn't feasible in a
    // unit test — inject a deterministic hash function so the integrity
    // check passes without needing the real model bytes. Production code
    // always uses the real SHA-256 (default parameter).
    const hashImpl = vi.fn(() => LAMA_PARAMS.EXPECTED_SHA256);

    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-inpaint',
      readFileImpl,
      hashImpl,
    });

    const width = 20;
    const height = 16;
    const input = { data: new Uint8ClampedArray(width * height * 4).fill(128), width, height };
    const mask = new Uint8Array(width * height).fill(1);

    const result = await runner.inpaint(input, mask);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(result.length).toBe(width * height * 4);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns the input unchanged when the mask is empty (no region to inpaint)', async () => {
    const readFileImpl = vi.fn();
    const runner = new OnnxNodeLamaRunner({
      cacheDir: '/tmp/nukebg-test-lama-empty-mask',
      readFileImpl,
    });

    const width = 8;
    const height = 8;
    const input = { data: new Uint8ClampedArray(width * height * 4).fill(64), width, height };
    const mask = new Uint8Array(width * height); // all zero — nothing to inpaint

    const result = await runner.inpaint(input, mask);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(result.length).toBe(width * height * 4);
    expect(Array.from(result)).toEqual(Array.from(input.data));
    expect(readFileImpl).not.toHaveBeenCalled();
  });
});
