#!/usr/bin/env node
// Compute sha256 CSP hashes for every inline <script> block in index.html.
// Used when updating JSON-LD (or any other inline script) to refresh the
// Content-Security-Policy header. Run: `node scripts/compute-csp-hashes.mjs`
//
// CSP hashes the EXACT bytes between <script ...> and </script>, whitespace
// and all. If the hash drifts, the browser silently blocks the script.
//
// Usage: invoke after editing index.html, copy the printed directives into
// nginx.conf + public/_headers. A future CI check (see issue #50) will
// fail when the computed set drifts from what's declared.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, '..', 'index.html');
// Normalize CRLF -> LF before hashing. Git checks out the file with the
// platform's native line endings (CRLF on Windows, LF on Linux), and CSP
// hashes the EXACT bytes — without this, the dev-tree hashes drift from
// the committed (LF) form and CI's csp-hashes.test.ts fails on Windows-
// authored edits even though production (Linux) is fine.
const html = readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');

// Match <script ...>...</script> blocks. We intentionally exclude scripts
// that use `src=` — those are fetched separately and covered by 'self'.
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const hashes = [];
let m;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1];
  const body = m[2];
  if (/\bsrc\s*=/.test(attrs)) continue; // external, covered by 'self'
  if (body.trim() === '') continue;
  const digest = createHash('sha256').update(body, 'utf8').digest('base64');
  hashes.push(`'sha256-${digest}'`);
}

console.log('# CSP hashes for inline <script> blocks in index.html');
console.log("# Paste into the script-src directive after 'self'.");
console.log(hashes.join(' '));
