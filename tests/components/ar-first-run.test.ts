import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #78 first-run model download explainer — relocated into ar-dropzone
 * so the page does NOT reflow when the model finishes warming up. The
 * panel sits in the same vertical row as the camera CTA; ar-app drives
 * it via dropzone.setLoadingState().
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const DZ = readFileSync(resolve(ROOT, 'src/components/ar-dropzone.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('first-run explainer (#78)', () => {
  it('lives inside ar-dropzone with prompt + bar + label', () => {
    expect(DZ).toMatch(/<div class="dz-loading"[^>]*hidden/);
    expect(DZ).toMatch(/class="dz-loading-prompt">\$/);
    expect(DZ).toMatch(/class="dz-loading-action">fetch --model RMBG-1\.4</);
    expect(DZ).toMatch(/id="dz-loading-bar"/);
    expect(DZ).toMatch(/id="dz-loading-label"/);
  });

  it('exposes a public setLoadingState({ visible, pct, label, ready }) API', () => {
    expect(DZ).toMatch(
      /setLoadingState\(state: \{[\s\S]*?visible: boolean;[\s\S]*?pct\?: number;[\s\S]*?label\?: string;[\s\S]*?ready\?: boolean;?\s*\}\): void/,
    );
    expect(DZ).toMatch(/this\.dropArea\?\.classList\.add\(['"]is-loading['"]\)/);
    expect(DZ).toMatch(/this\.dropArea\?\.classList\.remove\(['"]is-loading['"]\)/);
    expect(DZ).toMatch(/label\.textContent = t\(['"]firstRun\.ready['"]\)/);
  });

  it('ar-app reveals the slot after 400 ms of sustained loading (cold-cache heuristic)', () => {
    expect(APP).toMatch(
      /window\.setTimeout\([\s\S]*?this\.dropzone\.setLoadingState\(\{ visible: true \}\)[\s\S]*?\}, 400\)/,
    );
  });

  it('ar-app forwards "N%" worker messages into the dropzone bar', () => {
    expect(APP).toMatch(/match\(\/\(\\d\+\)\\s\*%\//);
    expect(APP).toMatch(
      /this\.dropzone\.setLoadingState\(\{ visible: true, pct, label: message \}\)/,
    );
  });

  it('ar-app finishes with ready=true on resolve, ready=false on reject', () => {
    expect(APP).toMatch(/\.then\(\(\) => \{[\s\S]*?finish\(true\)/);
    expect(APP).toMatch(/\.catch\(\(err:[\s\S]*?finish\(false\)/);
  });

  it('firstRun.ready key is present in all six locales', () => {
    const re = /'firstRun\.ready'\s*:/g;
    expect((I18N.match(re) ?? []).length).toBe(6);
  });

  it('respects prefers-reduced-motion for the progress bar transition', () => {
    expect(DZ).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.dz-loading-bar \{ transition: none/,
    );
  });
});

describe('status line — reactor offline → active flip', () => {
  it('initial render writes data-state="offline" + status.reactor.offline', () => {
    expect(APP).toMatch(
      /<span class="status-reactor"[^>]*data-state="offline">\$\{t\(['"]status\.reactor\.offline['"]\)\}/,
    );
    expect(APP).toMatch(
      /<span class="status-model"[^>]*data-state="loading">\$\{t\(['"]status\.model\.loading['"]\)\}/,
    );
  });

  it('preload success flips status-reactor data-state to "online" and status-model to "ready"', () => {
    expect(APP).toMatch(/r\.dataset\.state = ['"]online['"]/);
    expect(APP).toMatch(/r\.textContent = t\(['"]status\.reactor\.online['"]\)/);
    expect(APP).toMatch(/\(s as HTMLElement\)\.dataset\.state = ['"]ready['"]/);
  });

  it('CSS dims dot + reactor word while offline', () => {
    expect(APP).toMatch(
      /\.status-reactor\[data-state="offline"\] \{[\s\S]*?color: var\(--color-text-tertiary/,
    );
    expect(APP).toMatch(
      /\.status-line:has\(\.status-reactor\[data-state="offline"\]\) \.status-dot \{[\s\S]*?opacity: 0\.55/,
    );
  });

  it('status.reactor.offline is shipped in all six locales', () => {
    expect((I18N.match(/'status\.reactor\.offline'\s*:/g) ?? []).length).toBe(6);
  });
});

describe('hero disclaimer + support pitch (recovered from reactor copy)', () => {
  it('hero renders <p id="hero-disclaimer"> using features.disclaimer', () => {
    expect(APP).toMatch(
      /<p class="hero-disclaimer" id="hero-disclaimer">\$\{t\(['"]features\.disclaimer['"]\)\}/,
    );
  });

  it('hero renders <p id="hero-support"> using support.kofi', () => {
    expect(APP).toMatch(
      /<p class="hero-support" id="hero-support">\$\{t\(['"]support\.kofi['"]\)\}/,
    );
  });

  it('updateTexts re-localizes both paragraphs on locale change', () => {
    expect(APP).toMatch(/heroDisclaimer\.innerHTML = t\(['"]features\.disclaimer['"]\)/);
    expect(APP).toMatch(/heroSupport\.innerHTML = t\(['"]support\.kofi['"]\)/);
  });

  it('support.kofi is shipped in all six locales', () => {
    expect((I18N.match(/'support\.kofi'\s*:/g) ?? []).length).toBe(6);
  });
});
