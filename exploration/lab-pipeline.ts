/**
 * Lab pipeline: run a challenger model (BiRefNet / RMBG-2.0) on an image
 * and return a result shaped to drop into ar-app.ts's existing compose step.
 *
 * The baseline (RMBG-1.4) always goes through the normal PipelineOrchestrator,
 * not through here — this path exists only for A/B against challengers.
 */

import type { ModelId, InferenceMode, ModelLoader } from './loaders/types';
import { createLoader } from './loaders';
import { segmentWithBboxRefine } from './bbox-refine';

export interface LabRunInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface LabRunOutput {
  alpha: Uint8Array;
  width: number;
  height: number;
  latencyMs: number;
  backend: 'webgpu' | 'wasm';
  refined: boolean;
}

const loaderCache = new Map<ModelId, ModelLoader>();

function getLoader(id: ModelId): ModelLoader {
  let loader = loaderCache.get(id);
  if (!loader) {
    loader = createLoader(id);
    loaderCache.set(id, loader);
  }
  return loader;
}

export async function runLab(
  model: ModelId,
  mode: InferenceMode,
  input: LabRunInput,
): Promise<LabRunOutput> {
  const loader = getLoader(model);
  if (mode === 'bbox-refine') {
    const r = await segmentWithBboxRefine(loader, input);
    return {
      alpha: r.alpha,
      width: r.width,
      height: r.height,
      latencyMs: r.latencyMs,
      backend: r.backend,
      refined: r.refined,
    };
  }
  const r = await loader.segment(input);
  return {
    alpha: r.alpha,
    width: r.width,
    height: r.height,
    latencyMs: r.latencyMs,
    backend: r.backend,
    refined: false,
  };
}

export async function disposeAllLoaders(): Promise<void> {
  for (const loader of loaderCache.values()) await loader.dispose();
  loaderCache.clear();
}
