import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCacheDir } from '../../src/runners/onnx-node-rmbg.js';

// ---------------------------------------------------------------------------
// Cache directory resolution priority (design §I.1):
//   1. --cache-dir flag value
//   2. TRANSFORMERS_CACHE env var
//   3. HF_HOME env var
//   4. env-paths('nukebg').cache
// ---------------------------------------------------------------------------

describe('resolveCacheDir', () => {
  const savedEnv = {
    TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE,
    HF_HOME: process.env.HF_HOME,
  };

  beforeEach(() => {
    delete process.env.TRANSFORMERS_CACHE;
    delete process.env.HF_HOME;
  });

  afterEach(() => {
    if (savedEnv.TRANSFORMERS_CACHE === undefined) {
      delete process.env.TRANSFORMERS_CACHE;
    } else {
      process.env.TRANSFORMERS_CACHE = savedEnv.TRANSFORMERS_CACHE;
    }
    if (savedEnv.HF_HOME === undefined) {
      delete process.env.HF_HOME;
    } else {
      process.env.HF_HOME = savedEnv.HF_HOME;
    }
  });

  it('prefers the --cache-dir flag value over any env var', () => {
    process.env.TRANSFORMERS_CACHE = '/env/transformers-cache';
    process.env.HF_HOME = '/env/hf-home';

    expect(resolveCacheDir('/flag/cache-dir')).toBe('/flag/cache-dir');
  });

  it('uses TRANSFORMERS_CACHE when the flag is absent', () => {
    process.env.TRANSFORMERS_CACHE = '/env/transformers-cache';
    process.env.HF_HOME = '/env/hf-home';

    expect(resolveCacheDir()).toBe('/env/transformers-cache');
  });

  it('uses HF_HOME when the flag and TRANSFORMERS_CACHE are absent', () => {
    process.env.HF_HOME = '/env/hf-home';

    expect(resolveCacheDir()).toBe('/env/hf-home');
  });

  it("falls back to env-paths('nukebg').cache when nothing else is set", () => {
    const result = resolveCacheDir();

    expect(result).not.toBe('');
    expect(result.toLowerCase()).toContain('nukebg');
  });
});
