import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #38 RTL scaffolding — actual translations aren't shipped, but the
 * runtime must already cooperate with `dir="rtl"` so a future RTL
 * locale flips the layout without code changes.
 */

import { getDirection } from '../../src/i18n';

const ROOT = resolve(__dirname, '..', '..');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');
const MAIN = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');

describe('i18n — getDirection', () => {
  it('returns "rtl" for known RTL languages (ar, he, fa, ur)', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('fa')).toBe('rtl');
    expect(getDirection('ur')).toBe('rtl');
  });

  it('handles BCP-47 region tags (ar-EG, he-IL)', () => {
    expect(getDirection('ar-EG')).toBe('rtl');
    expect(getDirection('he-IL')).toBe('rtl');
  });

  it('returns "ltr" for every locale we currently ship', () => {
    for (const l of ['en', 'es', 'fr', 'de', 'pt', 'zh']) {
      expect(getDirection(l)).toBe('ltr');
    }
  });

  it('falls back to "ltr" for unknown locales', () => {
    expect(getDirection('xx')).toBe('ltr');
    expect(getDirection('')).toBe('ltr');
  });
});

describe('setLocale wires document.documentElement.dir (#38)', () => {
  it('i18n module ships RTL_LOCALES + getDirection + dir assignment in setLocale', () => {
    expect(I18N).toMatch(/RTL_LOCALES = new Set\(\[/);
    expect(I18N).toMatch(/export function getDirection\(locale: string\): ['"]rtl['"] \| ['"]ltr['"]/);
    expect(I18N).toMatch(/document\.documentElement\.dir = getDirection\(locale\)/);
  });

  it('main.ts initI18n sets dir on initial boot', () => {
    expect(MAIN).toMatch(/import \{[^}]*getDirection[^}]*\} from ['"]\.\/i18n['"]/);
    expect(MAIN).toMatch(/document\.documentElement\.dir = getDirection\(locale\)/);
  });
});
