#!/usr/bin/env node
/**
 * Find i18n keys defined in src/i18n/index.ts that are never referenced
 * by a literal t('key') or t("key") call across src/. False positives are
 * possible when a key is built with template-literal interpolation (e.g.
 * t(`reactor.cat.${b.key}`)) — those need manual triage before delete.
 *
 * Usage: node scripts/find-unused-i18n.mjs
 *
 * Exit code is always 0 — this is a triage tool, not a CI gate. Pipe to
 * `wc -l` or `tee` if you want to process the output.
 *
 * Closes #193.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const I18N_FILE = join(ROOT, 'src/i18n/index.ts');
const SRC_DIR = join(ROOT, 'src');

// Pull keys from the `en` locale block — assume any locale defines the
// full key set. Cheap regex parse: only `'key': '...'` lines we care
// about. We look at all locales actually so the union is comprehensive.
function extractKeys() {
  const text = readFileSync(I18N_FILE, 'utf8');
  const KEY_RE = /^\s+['"]([\w.-]+)['"]\s*:/gm;
  const keys = new Set();
  let m;
  while ((m = KEY_RE.exec(text)) !== null) {
    keys.add(m[1]);
  }
  return [...keys];
}

function listSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|html)$/.test(name)) out.push(full);
  }
  return out;
}

function buildHaystack() {
  // Exclude i18n/index.ts itself — it defines keys, doesn't consume them.
  return listSourceFiles(SRC_DIR)
    .filter((p) => !p.endsWith(join('i18n', 'index.ts')))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}

function findUnused(keys, haystack) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unused = [];
  // A key counts as referenced if ANY of these match the haystack:
  //   1. literal `t('key')` / `t("key")` / t(`key`)
  //   2. template-interpolation prefix: `t(\`prefix.${...}` for any prefix
  //      path of the key
  //   3. concatenation prefix: `t('prefix.' +` (any prefix path)
  //   4. bare string literal anywhere — covers `t(key)` where `key` is a
  //      variable bound to one of a fixed set of literals (the cmdbar
  //      ternary pattern) or any other indirect lookup.
  // Heuristic 4 is broad, but false positives (key string appearing in
  // something unrelated) are safer than false negatives (deleting a key
  // that's actually used).
  for (const k of keys) {
    const esc = escape(k);

    if (new RegExp(`t\\(\\s*[\\'"\\\`]${esc}[\\'"\\\`]`).test(haystack)) continue;

    let prefixHit = false;
    const parts = k.split('.');
    for (let i = 1; i < parts.length; i++) {
      const prefix = escape(parts.slice(0, i).join('.'));
      // Template: t(`prefix.${...}`)
      if (new RegExp(`t\\(\\s*[\\\`]${prefix}\\.\\$\\{`).test(haystack)) {
        prefixHit = true;
        break;
      }
      // Concatenation: t('prefix.' + ...)  or  t("prefix." +
      if (new RegExp(`t\\(\\s*['"]${prefix}\\.['"]\\s*\\+`).test(haystack)) {
        prefixHit = true;
        break;
      }
    }
    if (prefixHit) continue;

    // Bare string literal — quoted occurrence anywhere.
    if (new RegExp(`['"\\\`]${esc}['"\\\`]`).test(haystack)) continue;

    unused.push(k);
  }
  return unused.sort();
}

const keys = extractKeys();
const haystack = buildHaystack();
const unused = findUnused(keys, haystack);

console.log(`# i18n: ${keys.length} keys defined, ${unused.length} candidate-unused`);
console.log(`# Run from repo root. Triage manually — interpolated keys may slip through`);
console.log(`# the prefix heuristic. False positives are safer than false negatives here.`);
console.log('');
for (const k of unused) console.log(k);
