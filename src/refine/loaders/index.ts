import type { ModelId, ModelLoader } from './types';
import { createRmbg14Loader } from './rmbg14';

export type { ModelId, ModelLoader, SegmentInput, SegmentOutput, InferenceMode } from './types';

/**
 * Single entry point so the lab UI doesn't need to know each module.
 * Every loader is created lazily — no session is opened until warmup().
 */
export function createLoader(id: ModelId): ModelLoader {
  switch (id) {
    case 'rmbg-1.4':
      return createRmbg14Loader();
  }
}

export const ALL_MODEL_IDS: ModelId[] = ['rmbg-1.4'];
