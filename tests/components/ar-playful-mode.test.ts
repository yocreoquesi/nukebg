import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * data-playful + quiet mode (#79) source invariants.
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'src/styles/main.css'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('playful-mode gating (#79)', () => {
  it('isPlayful() reads document.documentElement.dataset.playful', () => {
    expect(APP).toMatch(/private isPlayful\(\): boolean/);
    expect(APP).toMatch(/document\.documentElement\.dataset\.playful !== ['"]false['"]/);
  });

  it('applyPrecisionSideEffects short-circuits to clearPlayfulState when quiet', () => {
    expect(APP).toMatch(/if \(!this\.isPlayful\(\)\) \{[\s\S]*?this\.clearPlayfulState\(\);[\s\S]*?return;[\s\S]*?\}/);
  });

  it('clearPlayfulState removes CSS vars, kills CRT flicker, hides smoke, resets marquees', () => {
    expect(APP).toMatch(/private clearPlayfulState\(\): void/);
    expect(APP).toMatch(/removeProperty\(p\)/);
    expect(APP).toMatch(/this\.stopCrtFlicker\(\)/);
    expect(APP).toMatch(/smoke\.classList\.remove\(['"]active['"]\)/);
  });

  it('resolvePlayfulMode defaults on; prefers-reduced-motion flips it off; localStorage wins', () => {
    expect(APP).toMatch(/resolvePlayfulMode\(\): void/);
    expect(APP).toMatch(/localStorage\.getItem\(['"]nukebg:playful['"]\)/);
    expect(APP).toMatch(/matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/);
    expect(APP).toMatch(/dataset\.playful = reducedMotion \? ['"]false['"] : ['"]true['"]/);
  });

  it('setPlayfulMode persists to localStorage and re-applies the current precision', () => {
    expect(APP).toMatch(/setPlayfulMode\(playful: boolean\): void/);
    expect(APP).toMatch(/localStorage\.setItem\(['"]nukebg:playful['"], playful \? ['"]true['"] : ['"]false['"]\)/);
    expect(APP).toMatch(/this\.applyPrecisionSideEffects\(idx\)/);
  });

  it('boot hook calls resolvePlayfulMode before first render', () => {
    expect(APP).toMatch(
      /connectedCallback\(\): void \{[\s\S]*?this\.resolvePlayfulMode\(\);[\s\S]*?this\.render\(\);/,
    );
  });
});

describe('quiet-mode toggle in the footer', () => {
  it('index.html renders <button id="quiet-mode-toggle"> in the footer', () => {
    expect(HTML).toMatch(/<button[^>]*id="quiet-mode-toggle"[^>]*class="footer-quiet-btn"/);
  });

  it('main.css styles .footer-quiet-btn with the same footer tone + accent pressed state', () => {
    expect(CSS).toMatch(/\.footer-quiet-btn \{[\s\S]*?color: var\(--color-text-tertiary\)/);
    expect(CSS).toMatch(/\.footer-quiet-btn\[aria-pressed="true"\] \{[\s\S]*?color: var\(--color-accent-primary\)/);
  });

  it('setupEvents wires click through setPlayfulMode(!this.isPlayful())', () => {
    expect(APP).toMatch(/getElementById\(['"]quiet-mode-toggle['"]\)/);
    expect(APP).toMatch(/this\.setPlayfulMode\(!this\.isPlayful\(\)\)/);
  });
});

describe('i18n parity — footer.{quiet,playful}Mode', () => {
  for (const key of ['footer.quietMode', 'footer.playfulMode']) {
    it(`'${key}' declared in all six locales`, () => {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length).toBe(6);
    });
  }
});
