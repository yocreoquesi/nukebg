/**
 * Shared state for the model lab: which model + mode the UI has selected.
 * Lives in exploration/ because it's staging-only plumbing, but ar-app.ts
 * imports from here to route processImage when the lab is active.
 */

import type { ModelId, InferenceMode } from './loaders/types';

export interface LabState {
  model: ModelId | 'baseline';
  mode: InferenceMode;
}

const DEFAULT_STATE: LabState = { model: 'baseline', mode: 'single-pass' };

let current: LabState = { ...DEFAULT_STATE };
const listeners = new Set<(state: LabState) => void>();

export function getLabState(): LabState {
  return { ...current };
}

export function setLabState(next: Partial<LabState>): void {
  current = { ...current, ...next };
  for (const fn of listeners) fn({ ...current });
}

export function onLabStateChange(fn: (state: LabState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isLabActive(state: LabState = current): boolean {
  return state.model !== 'baseline';
}
