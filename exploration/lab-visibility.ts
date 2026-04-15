/**
 * Single source of truth for whether the model-lab UI is visible.
 * Production stays locked to the default model with no selector shown.
 */
export function isLabVisible(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.pages.dev')) return true;
  return false;
}
