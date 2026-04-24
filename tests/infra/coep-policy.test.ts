import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #41 acceptance — "document.crossOriginIsolated === true OR the app
 * documents it doesn't need to be". We declined crossOriginIsolated
 * because onnxruntime-web + transformers.js fall back to single-thread
 * WASM cleanly and enabling COEP would break HF/jsdelivr fetches.
 *
 * This test locks that decision: COEP must stay absent AND the
 * rationale must be documented in nginx.conf so future maintainers
 * don't accidentally re-add it without reading why.
 */

const ROOT = resolve(__dirname, '..', '..');
const NGINX = readFileSync(resolve(ROOT, 'nginx.conf'), 'utf8');
const HEADERS = readFileSync(resolve(ROOT, 'public/_headers'), 'utf8');

describe('COEP policy — #41', () => {
  it('nginx.conf does NOT set Cross-Origin-Embedder-Policy', () => {
    expect(NGINX).not.toMatch(/add_header\s+Cross-Origin-Embedder-Policy/);
  });

  it('_headers does NOT set Cross-Origin-Embedder-Policy', () => {
    expect(HEADERS).not.toMatch(/Cross-Origin-Embedder-Policy/);
  });

  it('nginx.conf documents the rationale for not enabling COEP', () => {
    expect(NGINX).toMatch(/COEP intentionally NOT set/);
    expect(NGINX).toMatch(/#41/);
    expect(NGINX).toMatch(/SharedArrayBuffer/);
  });

  it('Cross-Origin-Opener-Policy IS set (COOP-only mode)', () => {
    expect(NGINX).toMatch(/Cross-Origin-Opener-Policy "same-origin"/);
    expect(HEADERS).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/);
  });
});
