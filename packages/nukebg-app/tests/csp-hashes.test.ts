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
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
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
  const base = path.startsWith('infra/') ? REPO_ROOT : ROOT;
  const text = readFileSync(resolve(base, path), 'utf8');
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

/**
 * CSP connect-src reachability guard (issue #375).
 *
 * The ML weights are fetched from huggingface.co, which 302s to a
 * regional CDN host. Hugging Face has moved that host twice already
 * (cdn-lfs.huggingface.co -> cas-bridge.xethub.hf.co -> *.cdn.hf.co).
 * CSP applies to redirect targets, so a stale allowlist turns the
 * model download into an opaque `(canceled)` fetch and every stage
 * after `ml-segmentation` dies with no usable error.
 *
 * These tests assert against real host names rather than the literal
 * policy string, so they fail for the reason that actually breaks
 * production: a host we must reach is not reachable.
 */

/** Every CSP declaration in a file — nginx.conf carries three. */
function allCspFrom(path: string): string[] {
  const base = path.startsWith('infra/') ? REPO_ROOT : ROOT;
  const text = readFileSync(resolve(base, path), 'utf8');
  const matches = text.match(/Content-Security-Policy[^\n]*/g);
  if (!matches || matches.length === 0) throw new Error(`No CSP header in ${path}`);
  return matches;
}

function connectSrcOf(csp: string): string[] {
  const directive = csp.match(/connect-src ([^;"]+)/)?.[1];
  if (!directive) throw new Error(`No connect-src in: ${csp.slice(0, 80)}...`);
  return directive.trim().split(/\s+/);
}

/**
 * Minimal CSP host-source matcher: enough to answer "would this policy
 * let the browser reach this URL?". Implements the `*.` label-suffix
 * wildcard, which per CSP matches any depth of subdomain.
 */
function cspAllows(sources: string[], url: string): boolean {
  const { host } = new URL(url);
  return sources.some((src) => {
    if (src === "'self'" || src === '*') return src === '*';
    const srcHost = src.replace(/^https:\/\//, '').replace(/\/.*$/, '');
    if (srcHost.startsWith('*.')) return host.endsWith(srcHost.slice(1));
    return host === srcHost;
  });
}

/**
 * Hosts the RMBG-1.4 download is known to land on. `us.aws.cdn.hf.co`
 * is the host observed in the redirect chain when #375 was diagnosed;
 * the others are the regional siblings HF routes to by geography, which
 * is why pinning individual hosts kept breaking for users outside the
 * region the maintainer happened to test from.
 */
const MODEL_FETCH_URLS = [
  'https://huggingface.co/briaai/RMBG-1.4/resolve/abc123/onnx/model_quantized.onnx',
  'https://us.aws.cdn.hf.co/xet-bridge-us/6578ba03/11b4080f?Expires=1&Signature=x',
  'https://eu.aws.cdn.hf.co/xet-bridge-eu/6578ba03/11b4080f?Expires=1&Signature=x',
  'https://cas-bridge.xethub.hf.co/xet-bridge-us/6578ba03/11b4080f',
  'https://transfer.xethub.hf.co/xet-bridge-us/6578ba03/11b4080f',
  'https://cdn-lfs-us-1.huggingface.co/repos/6578ba03/model_quantized.onnx',
];

const CSP_FILES = ['infra/nginx.conf', 'public/_headers'];

describe('CSP connect-src reaches the model CDN', () => {
  it('every CSP declaration allows every known model-download host', () => {
    for (const path of CSP_FILES) {
      const declarations = allCspFrom(path);
      expect(declarations.length, `no CSP declarations found in ${path}`).toBeGreaterThan(0);
      for (const csp of declarations) {
        const sources = connectSrcOf(csp);
        for (const url of MODEL_FETCH_URLS) {
          expect(
            cspAllows(sources, url),
            `${path}: connect-src blocks ${new URL(url).host} — the model download will surface as a (canceled) fetch (see #375)`,
          ).toBe(true);
        }
      }
    }
  });

  it('nginx.conf declares connect-src on every server block it protects', () => {
    // A single stale block is enough to break production for whichever
    // vhost serves it, and the hash tests below only inspect the first.
    const declarations = allCspFrom('infra/nginx.conf');
    expect(declarations.length).toBe(3);
    for (const csp of declarations) {
      expect(connectSrcOf(csp)).toContain("'self'");
    }
  });

  it('keeps every CSP declaration in the two files byte-identical', () => {
    // nginx.conf and _headers must not drift: the app is served from
    // both, and a fix applied to one only is the failure mode that made
    // #375 survive as long as it did.
    const policies = CSP_FILES.flatMap((p) => allCspFrom(p).map((c) => connectSrcOf(c).join(' ')));
    const unique = [...new Set(policies)];
    expect(unique, `connect-src drifted between declarations:\n${unique.join('\n')}`).toHaveLength(
      1,
    );
  });
});
