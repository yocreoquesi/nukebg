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

describe('Dropzone camera CTA (#73)', () => {
  it('renders a second <input type="file" capture="environment">', () => {
    expect(DZ).toMatch(/<input[^>]*type="file"[^>]*capture="environment"[^>]*class="dz-camera-input"/);
  });

  it('renders a #dz-camera-cta button with takePhoto label', () => {
    expect(DZ).toMatch(/id="dz-camera-cta"/);
    expect(DZ).toMatch(/t\(['"]dropzone\.takePhoto['"]\)/);
  });

  it('camera CTA is visible only on coarse pointer OR ≤ 480 px', () => {
    expect(DZ).toMatch(/\.dz-camera-cta \{[\s\S]*?display: none;/);
    expect(DZ).toMatch(/@media \(pointer: coarse\), \(max-width: 480px\) \{[\s\S]*?\.dz-camera-cta \{ display: inline-flex/);
  });

  it('camera CTA click stops propagation + triggers the camera input, not the main one', () => {
    expect(DZ).toMatch(/cameraBtn\?\.addEventListener\(['"]click['"],[\s\S]*?stopPropagation\(\)[\s\S]*?this\.cameraInput\.click\(\)/);
  });

  it('main dropzone click ignores events bubbling from the camera CTA', () => {
    expect(DZ).toMatch(/target\?\.closest\(['"]#dz-camera-cta['"]\)\) return/);
  });

  it('cameraInput "change" handler routes into the existing handleFiles path', () => {
    expect(DZ).toMatch(/this\.cameraInput\.addEventListener\(['"]change['"],[\s\S]*?this\.handleFiles\(this\.cameraInput\.files\)/);
  });
});

describe('i18n parity — hero.*.short + dropzone.takePhoto', () => {
  const keys = ['hero.title.short', 'hero.subtitle.short', 'dropzone.takePhoto'];
  for (const key of keys) {
    it(`'${key}' declared in all six locales`, () => {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length).toBe(6);
    });
  }
});
