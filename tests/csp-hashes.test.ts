import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * CSP sha256 hash drift guard.
 *
 * Every inline <script> block in index.html (JSON-LD blocks, currently 3
 * of them) must have a matching `'sha256-...'` entry in the CSP header
 * declared in both nginx.conf and public/_headers. If JSON-LD content
 * is edited without regenerating hashes, the browser silently blocks
 * the script — this test catches that at CI time.
 *
 * Regenerate with `node scripts/compute-csp-hashes.mjs`.
 */

const ROOT = resolve(__dirname, '..');
const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

function extractInlineHashes(): string[] {
  // Normalize CRLF -> LF: index.html is stored as LF in the repo, but
  // Windows checkouts deliver CRLF. CSP hashes the exact bytes, so we
  // hash against the canonical (LF) form to match what production
  // serves, regardless of the dev OS.
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const hashes: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = INLINE_SCRIPT_RE.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2];
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (body.trim() === '') continue;
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function cspFrom(path: string): string {
  const text = readFileSync(resolve(ROOT, path), 'utf8');
  const match = text.match(/Content-Security-Policy[^\n]*/);
  if (!match) throw new Error(`No CSP header in ${path}`);
  return match[0];
}

describe('CSP inline-script hashes', () => {
  const expected = extractInlineHashes();

  it('has at least one inline <script> block to hash', () => {
    expect(expected.length).toBeGreaterThan(0);
  });

  it('nginx.conf CSP declares every inline-script hash', () => {
    const csp = cspFrom('infra/nginx.conf');
    for (const h of expected) {
      expect(csp, `missing ${h} in nginx.conf CSP`).toContain(h);
    }
  });

  it('public/_headers CSP declares every inline-script hash', () => {
    const csp = cspFrom('public/_headers');
    for (const h of expected) {
      expect(csp, `missing ${h} in public/_headers CSP`).toContain(h);
    }
  });

  it('no CSP still carries script-src unsafe-inline', () => {
    for (const p of ['infra/nginx.conf', 'public/_headers']) {
      const csp = cspFrom(p);
      const scriptSrc = csp.match(/script-src [^;]+/)?.[0] ?? '';
      expect(scriptSrc, `${p} script-src still has 'unsafe-inline'`).not.toMatch(/'unsafe-inline'/);
    }
  });
});
