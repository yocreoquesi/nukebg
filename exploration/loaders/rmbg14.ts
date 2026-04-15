/**
 * RMBG-1.4 loader — delegates to the existing ml.worker.ts path so the lab
 * compares against the real production baseline, not a reimplementation.
 *
 * This file intentionally stays thin: the heavy work lives in src/workers/ml.worker.ts
 * and this loader just adapts that interface to the ModelLoader contract.
 */

import type { ModelLoader, SegmentInput, SegmentOutput } from './types';

export function createRmbg14Loader(): ModelLoader {
  return {
    id: 'rmbg-1.4',
    label: 'RMBG-1.4 (baseline, INT8)',
    approxDownloadMb: 45,
    requiresWebGpu: false,
    async warmup() {
      // no-op: ml.worker.ts handles its own warmup on first segment()
    },
    async segment(_input: SegmentInput): Promise<SegmentOutput> {
      throw new Error('rmbg14 loader: wire up to ml.worker.ts in Phase 4');
    },
    async dispose() {
      // ml.worker.ts owns the lifecycle today — nothing to free here
    },
  };
}
