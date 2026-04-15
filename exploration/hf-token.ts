/**
 * HF token access helper for gated repos (local-only exploration).
 *
 * Policy: the token is NEVER baked at build time. Users paste it once into
 * DevTools on their local machine:
 *   localStorage.setItem('nukebg:hf-token', 'hf_xxx')
 *
 * The token is used exclusively to fetch weights from gated HF repos that
 * don't have a public mirror (currently RMBG-2.0). It is sent as
 * Authorization: Bearer <token> on the weight fetch.
 *
 * Production (nukebg.app) never reads this — the lab selector is gated
 * behind isLabVisible() which returns false there.
 */

const STORAGE_KEY = 'nukebg:hf-token';

export function getHfToken(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.startsWith('hf_') ? v : null;
  } catch {
    return null;
  }
}

export function hasHfToken(): boolean {
  return getHfToken() !== null;
}
