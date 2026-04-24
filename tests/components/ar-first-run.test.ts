import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #78 first-run model download explainer — source invariants.
 * The panel lives in ar-app's render and is toggled purely via the
 * existing model-progress / model-ready callbacks; no new worker
 * wiring required.
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('first-run explainer (#78)', () => {
  it('renders a hidden <div class="first-run-panel"> with prompt + bar + label', () => {
    expect(APP).toMatch(/<div class="first-run-panel"[^>]*hidden/);
    expect(APP).toMatch(/class="first-run-prompt">\$</);
    expect(APP).toMatch(/class="first-run-action">fetch --model RMBG-1\.4</);
    expect(APP).toMatch(/id="first-run-bar"/);
    expect(APP).toMatch(/id="first-run-label"/);
  });

  it('reveals after 400 ms of sustained loading (cold-cache heuristic)', () => {
    expect(APP).toMatch(
      /firstRunRevealTimer = window\.setTimeout\([\s\S]*?this\.setFirstRunVisible\(true\)[\s\S]*?\}, 400\)/,
    );
  });

  it('parses "N%" messages into the bar width', () => {
    expect(APP).toMatch(/updateFirstRunFromMessage\(message\?:\s*string\): void/);
    expect(APP).toMatch(/match\(\/\(\\d\+\)\\s\*%\//);
    expect(APP).toMatch(/\$\{pct\}%/);
  });

  it('settleFirstRun(ready) clears the reveal timer and dismisses after a brief grace', () => {
    expect(APP).toMatch(/private settleFirstRun\(state: ['"]ready['"] \| ['"]error['"]\): void/);
    expect(APP).toMatch(/window\.clearTimeout\(this\.firstRunRevealTimer\)/);
    expect(APP).toMatch(
      /setTimeout\(\(\) => \{ panel\.hidden = true; \}, 600\)/,
    );
  });

  it('settleFirstRun is wired to both resolve + reject paths of preloadModel()', () => {
    expect(APP).toMatch(
      /\.then\(\(\) => \{[\s\S]*?this\.settleFirstRun\(['"]ready['"]\)/,
    );
    expect(APP).toMatch(
      /\.catch\(\(err:[\s\S]*?this\.settleFirstRun\(['"]error['"]\)/,
    );
  });

  it('firstRun.ready key is present in all six locales', () => {
    const re = /'firstRun\.ready'\s*:/g;
    expect((I18N.match(re) ?? []).length).toBe(6);
  });

  it('respects prefers-reduced-motion for the progress bar transition', () => {
    expect(APP).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.first-run-bar \{ transition: none/,
    );
  });
});
