import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Theme switcher (footer) — replaces the deleted Reactor segmented
 * control with a pure-cosmetic palette swap.
 *
 * Source invariants:
 *   1. Four swatches in the footer (green / amber / cyan / magenta)
 *      with WAI-ARIA radiogroup semantics
 *   2. main.ts persists choice via localStorage["nukebg:theme"]
 *   3. main.css ships per-theme :root[data-theme="X"] overrides
 *   4. Default state has aria-checked="true" on green
 */

const ROOT = resolve(__dirname, '..');
const HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'src/styles/main.css'), 'utf8');
const MAIN = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');

describe('theme switcher — DOM', () => {
  it('renders <div class="theme-picker" role="radiogroup"> in the footer', () => {
    expect(HTML).toMatch(/<div class="theme-picker" role="radiogroup"/);
    expect(HTML).toMatch(/aria-label="Theme"/);
  });

  it('exposes four swatches: green / amber / cyan / magenta', () => {
    for (const name of ['green', 'amber', 'cyan', 'magenta']) {
      expect(HTML).toMatch(new RegExp(`data-theme="${name}"`));
      expect(HTML).toMatch(new RegExp(`<button[^>]*role="radio"[^>]*data-theme="${name}"`));
    }
  });

  it('green is the default (aria-checked="true" only on green)', () => {
    const checkedTrue =
      HTML.match(
        /aria-checked="true"[^>]*data-theme="(\w+)"|data-theme="(\w+)"[^>]*aria-checked="true"/g,
      ) ?? [];
    expect(checkedTrue.length).toBe(1);
    expect(checkedTrue[0]).toMatch(/data-theme="green"/);
  });
});

describe('theme switcher — palettes in main.css', () => {
  for (const theme of ['amber', 'cyan', 'magenta']) {
    it(`:root[data-theme="${theme}"] overrides accent + text-* tokens`, () => {
      // Accept either quote style — prettier may normalize to single quotes.
      const re = new RegExp(
        `:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{[\\s\\S]*?--color-accent-primary[\\s\\S]*?--color-text-primary`,
      );
      expect(CSS).toMatch(re);
    });
  }

  it('green has no override block (it is the :root default)', () => {
    expect(CSS).not.toMatch(/:root\[data-theme=['"]green['"]\]/);
  });
});

describe('theme switcher — main.ts wiring', () => {
  it('reads localStorage["nukebg:theme"] on boot and applies it', () => {
    expect(MAIN).toMatch(/THEME_STORAGE_KEY = ['"]nukebg:theme['"]/);
    expect(MAIN).toMatch(/localStorage\.getItem\(THEME_STORAGE_KEY\)/);
    expect(MAIN).toMatch(/applyTheme\(initial\)/);
  });

  it('applyTheme deletes data-theme for green and sets it for the others', () => {
    expect(MAIN).toMatch(
      /if \(theme === ['"]green['"]\)[\s\S]*?delete document\.documentElement\.dataset\.theme/,
    );
    expect(MAIN).toMatch(/document\.documentElement\.dataset\.theme = theme/);
  });

  it('initThemeSwitcher is wired into init() and click+keydown drive selection', () => {
    expect(MAIN).toMatch(/^\s*initThemeSwitcher\(\);\s*$/m);
    expect(MAIN).toMatch(/picker\.addEventListener\(['"]click['"]/);
    expect(MAIN).toMatch(/picker\.addEventListener\(['"]keydown['"]/);
    expect(MAIN).toMatch(/localStorage\.setItem\(THEME_STORAGE_KEY/);
  });

  it('keyboard nav cycles via Arrow / Home / End (WAI-ARIA radiogroup)', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(MAIN).toContain(`'${key}'`);
    }
  });
});
