import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * i18n key-parity guard.
 *
 * Every non-English locale must declare the exact same set of keys as
 * `en`. When that drifts, the runtime silently falls back to the
 * English value (see `t()` in `src/i18n/index.ts`), so a missing
 * key produces English text for users of that locale instead of a
 * visible error. This CI guard turns the drift into a red test.
 *
 * Implementation is deliberately source-string-based: the compiled
 * `translations` record is inconvenient to import in happy-dom, but
 * the shape of `src/i18n/index.ts` is regular — each locale block is
 * a sibling of the `en: { ... }` block inside the top-level object.
 *
 * Updates to i18n should add / remove keys in every locale; this
 * test pins that invariant.
 */

const ROOT = resolve(__dirname, '..');
const SOURCE = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

const EXPECTED_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh'] as const;

/**
 * Extract the `en: { ... }`-shaped blocks from the source. We rely on the
 * fact that each locale block sits at two-space indentation followed by
 * `<code>: {` and closes at a sibling `},` at the same indent.
 */
function extractLocaleBlock(code: (typeof EXPECTED_LOCALES)[number]): string {
  const openRe = new RegExp(`^  ${code}:\\s*\\{`, 'm');
  const openMatch = openRe.exec(SOURCE);
  if (!openMatch) throw new Error(`locale "${code}" block not found in i18n/index.ts`);
  let depth = 0;
  let i = openMatch.index;
  while (i < SOURCE.length) {
    const ch = SOURCE[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return SOURCE.slice(openMatch.index, i + 1);
    }
    i++;
  }
  throw new Error(`unterminated locale block for "${code}"`);
}

function extractKeys(block: string): string[] {
  // Keys look like `    'progress.cancel':` — quoted string followed by colon.
  // Ignore nested object keys (none exist today, but be conservative).
  const re = /^\s{4}'([^']+)'\s*:/gm;
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

describe('i18n key parity across locales', () => {
  const enBlock = extractLocaleBlock('en');
  const enKeys = extractKeys(enBlock);

  it('English block exposes at least 50 keys (sanity floor)', () => {
    // If this fails the extractor regressed; i18n is over 1000 lines
    // and never had fewer than ~150 keys in any shipped version.
    expect(enKeys.length).toBeGreaterThanOrEqual(50);
  });

  for (const code of EXPECTED_LOCALES) {
    if (code === 'en') continue;
    it(`${code} declares exactly the same keys as en`, () => {
      const block = extractLocaleBlock(code);
      const keys = extractKeys(block);
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      expect({ missing, extra }, `locale "${code}" key drift vs en`).toEqual({
        missing: [],
        extra: [],
      });
    });
  }
});
