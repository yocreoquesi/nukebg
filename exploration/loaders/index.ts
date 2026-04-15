import type { ModelId, ModelLoader } from './types';
import { createRmbg14Loader } from './rmbg14';
import { createRmbg20Loader } from './rmbg20';
import { createBiRefNetLoader } from './birefnet';

export type { ModelId, ModelLoader, SegmentInput, SegmentOutput, InferenceMode } from './types';

/**
 * Single entry point so the selector UI doesn't need to know each module.
 * Every loader is created lazily — no ONNX session is opened until warmup().
 */
export function createLoader(id: ModelId): ModelLoader {
  switch (id) {
    case 'rmbg-1.4':
      return createRmbg14Loader();
    case 'rmbg-2.0':
      return createRmbg20Loader();
    case 'birefnet-general':
      return createBiRefNetLoader();
  }
}

export const ALL_MODEL_IDS: ModelId[] = ['rmbg-1.4', 'rmbg-2.0', 'birefnet-general'];
