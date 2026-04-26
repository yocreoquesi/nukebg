import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Single source of truth for the version string: package.json.
// This suite asserts that every other file that hard-codes a version stays
// in sync after a bump, so we can't silently ship a mismatched build again
// (see Apr 15 incident: local 2.7.0 vs prod 2.6.0 drift).
const root = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
const expected = pkg.version;

const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

// Escape dots so the regex below treats "2.7.2" literally.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe(`version coherence (package.json @ ${expected})`, () => {
  it('package.json version is a valid SemVer major.minor.patch', () => {
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('src/main.ts console logo carries the same version', () => {
    const src = read('src/main.ts');
    expect(src).toMatch(new RegExp(`v${esc(expected)}\\s*\\|\\s*Terminal Edition`));
  });

  it('src/utils/image-io.ts PNG metadata carries the same version', () => {
    const src = read('src/utils/image-io.ts');
    // Prettier may strip quotes from the property key; accept either form.
    expect(src).toMatch(new RegExp(`['"]?Software['"]?:\\s*'NukeBG v${esc(expected)}'`));
  });

  it('index.html JSON-LD softwareVersion carries the same version', () => {
    const html = read('index.html');
    expect(html).toMatch(new RegExp(`"softwareVersion":\\s*"${esc(expected)}"`));
  });

  it('index.html footer label carries the same version', () => {
    const html = read('index.html');
    expect(html).toMatch(new RegExp(`v${esc(expected)}</span>`));
  });

  it('README.md version badge carries the same version', () => {
    const md = read('README.md');
    expect(md).toMatch(new RegExp(`version-${esc(expected)}-brightgreen`));
  });

  it('no file references an older 2.x hardcoded version', () => {
    // Guard against stragglers. This flags any "v2.7.1" (etc) that isn't the
    // current version. It checks the five files we actively bump.
    const files = {
      'src/main.ts': read('src/main.ts'),
      'src/utils/image-io.ts': read('src/utils/image-io.ts'),
      'index.html': read('index.html'),
      'README.md': read('README.md'),
      'package.json': read('package.json'),
    };
    const stale = /\b[vV]?(\d+)\.(\d+)\.(\d+)\b/g;
    for (const [path, body] of Object.entries(files)) {
      const matches = body.matchAll(stale);
      for (const m of matches) {
        const [, major, minor, patch] = m;
        // Only enforce coherence for the NukeBG product version line
        // (major 2, matching minor). Ignores third-party version strings
        // (schemas, libraries, etc.) that legitimately live elsewhere.
        const [eMaj, eMin] = expected.split('.');
        if (major === eMaj && minor === eMin && `${major}.${minor}.${patch}` !== expected) {
          throw new Error(`stale NukeBG version ${m[0]} in ${path} (expected ${expected})`);
        }
      }
    }
  });
});
