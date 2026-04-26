import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Mobile hero + camera CTA (#73) source invariants.
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const DZ = readFileSync(resolve(ROOT, 'src/components/ar-dropzone.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('Mobile hero — short-form copy swap (#73)', () => {
  it('renders both long and short title + subtitle spans', () => {
    expect(APP).toMatch(/class="hero-title-long"/);
    expect(APP).toMatch(/class="hero-title-short"/);
    expect(APP).toMatch(/class="subline-long"/);
    expect(APP).toMatch(/class="subline-short"/);
    expect(APP).toMatch(/t\(['"]hero\.title\.short['"]\)/);
    expect(APP).toMatch(/t\(['"]hero\.subtitle\.short['"]\)/);
  });

  it('CSS swaps which variant renders at ≤ 480 px', () => {
    expect(APP).toMatch(/\.hero-title-short, \.subline-short \{ display: none; \}/);
    expect(APP).toMatch(/@media \(max-width: 480px\)\s*\{[\s\S]*?\.hero-title-long, \.subline-long \{ display: none/);
  });

  it('updateTexts renders both spans so locale-change keeps the swap working', () => {
    expect(APP).toMatch(/hero-title-long[\s\S]*?hero-title-short/);
    expect(APP).toMatch(/subline-long[\s\S]*?subline-short/);
  });
});

// Camera CTA (#73) was removed in #146 — tapping the dropzone box on
// mobile already opens the OS file picker, which exposes the camera as
// one of the source options. The dedicated button was duplicating that
// affordance and made the mobile UX inconsistent with desktop.
describe('Dropzone camera CTA — removed (#146)', () => {
  it('no longer ships a dedicated camera input or CTA button', () => {
    expect(DZ).not.toMatch(/dz-camera-cta/);
    expect(DZ).not.toMatch(/dz-camera-input/);
    expect(DZ).not.toMatch(/capture="environment"/);
    expect(DZ).not.toMatch(/dropzone\.takePhoto/);
  });
});

describe('i18n parity — hero.*.short', () => {
  const keys = ['hero.title.short', 'hero.subtitle.short'];
  for (const key of keys) {
    it(`'${key}' declared in all six locales`, () => {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length).toBe(6);
    });
  }
});
