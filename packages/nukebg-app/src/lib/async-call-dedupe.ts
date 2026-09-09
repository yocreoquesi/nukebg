/**
 * Deduplicate concurrent async calls that share the same key.
 *
 * Extracted out of `ml.worker.ts`'s `loadModel()` (in-flight load race):
 * that function's only "already loaded" guard was `segmenters.has(modelId)`,
 * checked BEFORE the async `transformers.pipeline()` call resolves. Two
 * callers for the same modelId arriving close together (e.g. the explicit
 * `preload()` fired from ar-app.ts on page load, racing the auto-load
 * `segment()` performs when no model is loaded yet) both pass that guard
 * and each start their own `transformers.pipeline()` call — a second
 * ~45MB download and a second WASM session in the same worker.
 *
 * `AsyncCallDedupe` fixes the general shape of that problem: only the
 * first caller for a given key actually runs `factory()`; every other
 * caller for the same key while that call is still in flight awaits the
 * SAME promise instead of starting a new one. The in-flight entry is
 * removed as soon as the call settles — on both success and failure — so
 * a failed call does not permanently cache a rejected promise and can be
 * retried on the next call for that key.
 *
 * Note this only dedupes the underlying work behind `factory()`. Any
 * per-caller side effects (e.g. ml.worker.ts's caller-specific
 * `model-progress` / `model-ready` postMessage, keyed by that caller's
 * own request id) must still be performed by each caller individually
 * after `run()` resolves — never bake caller identity into `factory()`.
 */
export class AsyncCallDedupe<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  /**
   * Run `factory()` for `key`, unless a call for the same key is already
   * in flight — in which case the existing promise is returned so the
   * caller awaits the SAME underlying work instead of starting a new one.
   */
  run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = factory().finally(() => {
      // Guard against clearing a newer entry in case of exotic re-entrancy
      // (factory() somehow re-registering the same key before settling).
      // Normal usage never triggers this, but it keeps the map correct.
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Number of keys currently in flight. Test-only introspection. */
  get size(): number {
    return this.inFlight.size;
  }
}
