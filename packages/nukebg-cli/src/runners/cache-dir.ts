import envPaths from 'env-paths';

// ---------------------------------------------------------------------------
// Shared cache directory resolution (design §I.1). Used by both
// `OnnxNodeRmbgRunner` (via `@huggingface/transformers`' `env.cacheDir`) and
// `OnnxNodeLamaRunner` (direct `onnxruntime-node` model cache). Hoisted out
// of `onnx-node-rmbg.ts` since the resolution logic is model-agnostic.
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk cache directory for downloaded models, in priority
 * order:
 *   1. `--cache-dir` flag value (explicit user override)
 *   2. `TRANSFORMERS_CACHE` env var (Python `transformers` convention)
 *   3. `HF_HOME` env var (Python `transformers` convention, fallback)
 *   4. `env-paths('nukebg').cache` (OS-appropriate default, e.g. `~/.cache/nukebg`)
 */
export function resolveCacheDir(flagValue?: string): string {
  if (flagValue) return flagValue;
  if (process.env.TRANSFORMERS_CACHE) return process.env.TRANSFORMERS_CACHE;
  if (process.env.HF_HOME) return process.env.HF_HOME;
  return envPaths('nukebg', { suffix: '' }).cache;
}
