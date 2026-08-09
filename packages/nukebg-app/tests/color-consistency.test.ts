import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Color consistency tests for the power mode theming system.
 *
 * NukeBG uses CSS custom properties for all colors so that power modes
 * (Normal, Low Power, High Power, Full Nuke) can retheme the entire UI.
 * These tests catch regressions where a hardcoded color bypasses the
 * variable system.
 *
 * Rule: NO component file should use raw green hex or rgba values in
 * CSS templates. All colors must go through var(--color-*) tokens.
 */

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

// ── Helpers ──────────────────────────────────────────────────────────

/** Read all .ts files from a directory */
function readComponentFiles(dir: string): { name: string; content: string }[] {
  const absDir = resolve(root, dir);
  return readdirSync(absDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: join(dir, f), content: readFileSync(resolve(absDir, f), 'utf8') }));
}

/** Extract CSS template strings from a component file (inside backtick <style>...</style>) */
function extractCssBlocks(source: string): string[] {
  const blocks: string[] = [];
  const regex = /<style>([\s\S]*?)<\/style>/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

// Theme green hex values that MUST go through CSS variables
const FORBIDDEN_HEX = [
  '#00ff41', // --color-accent-primary / --color-text-primary
  '#00dd44', // --color-text-secondary
  '#00b34a', // --color-text-tertiary (WCAG AA bump from #008830)
  '#008830', // previous tertiary — keep blocked so it can't regress
  '#1a3a1a', // --color-surface-border
  '#ffd700', // old --color-accent (no longer exists)
  '#995300', // amber tertiary previous (3.59:1 fail) — keep blocked
];

// Allowed contexts where these hex values appear as CSS variable FALLBACKS
// e.g. var(--color-accent-primary, #00ff41) is fine
const VAR_FALLBACK_PATTERN = /var\(\s*--[\w-]+\s*,\s*([^)]+)\)/g;

/** Remove var() fallback values from CSS so they don't trigger false positives */
function stripVarFallbacks(css: string): string {
  return css.replace(VAR_FALLBACK_PATTERN, 'var(--STRIPPED)');
}

// ── Tests ────────────────────────────────────────────────────────────

describe('color consistency — no hardcoded theme colors in components', () => {
  const components = readComponentFiles('src/components');

  for (const { name, content } of components) {
    const cssBlocks = extractCssBlocks(content);
    if (cssBlocks.length === 0) continue;

    describe(name, () => {
      for (const hex of FORBIDDEN_HEX) {
        it(`CSS has no bare ${hex} outside var() fallbacks`, () => {
          for (const css of cssBlocks) {
            const stripped = stripVarFallbacks(css);
            // Check for the hex as a standalone color value (not inside a variable name)
            const regex = new RegExp(
              `(?:color|background|border|box-shadow|text-shadow|filter|accent-color|border-color|border-top|border-bottom|border-left|border-right)\\s*:[^;]*${hex.replace('#', '#')}`,
              'gi',
            );
            const matches = stripped.match(regex) || [];
            expect(
              matches,
              `Found hardcoded ${hex} in ${name} CSS:\n  ${matches.join('\n  ')}`,
            ).toHaveLength(0);
          }
        });
      }

      it('CSS has no bare rgba(0, 255, 65, ...) outside var() fallbacks', () => {
        for (const css of cssBlocks) {
          const stripped = stripVarFallbacks(css);
          const regex = /rgba\(\s*0\s*,\s*255\s*,\s*65/gi;
          const matches = stripped.match(regex) || [];
          expect(matches, `Found hardcoded rgba(0,255,65,...) in ${name} CSS`).toHaveLength(0);
        }
      });

      it('CSS has no bare rgba(255, 215, 0, ...) (old gold accent)', () => {
        for (const css of cssBlocks) {
          const regex = /rgba\(\s*255\s*,\s*215\s*,\s*0/gi;
          const matches = stripped(css).match(regex) || [];
          expect(matches, `Found hardcoded rgba(255,215,0,...) in ${name} CSS`).toHaveLength(0);
        }

        function stripped(css: string) {
          return stripVarFallbacks(css);
        }
      });
    });
  }
});

describe('color consistency — main.css variable definitions', () => {
  const css = read('src/styles/main.css');

  it('defines --color-accent-rgb in :root', () => {
    expect(css).toMatch(/--color-accent-rgb\s*:/);
  });

  it('defines --color-success in :root', () => {
    expect(css).toMatch(/--color-success\s*:/);
  });

  it('defines --color-info in :root', () => {
    expect(css).toMatch(/--color-info\s*:/);
  });

  it('defines --color-surface-border in :root', () => {
    expect(css).toMatch(/--color-surface-border\s*:/);
  });
});

describe('color consistency — no non-existent CSS variables', () => {
  const components = readComponentFiles('src/components');
  // var(--color-accent, ...) was a common mistake — this variable doesn't exist
  const GHOST_VARS = [
    '--color-accent,', // trailing comma = used as var(--color-accent, fallback)
  ];

  for (const { name, content } of components) {
    for (const ghost of GHOST_VARS) {
      it(`${name} does not reference non-existent ${ghost.replace(',', '')}`, () => {
        expect(content).not.toContain(ghost);
      });
    }
  }
});

describe('color consistency — :host must not shadow theme variables', () => {
  const components = readComponentFiles('src/components');

  // CSS custom properties declared on :host shadow inherited values from
  // document.documentElement, breaking the power mode cascade.
  // Only non-theme variables may be declared on :host.
  const CUSTOM_PROP_DECL = /--[\w-]+\s*:/g;
  const THEME_VAR_PREFIXES = ['--color-', '--terminal-color-'];

  for (const { name, content } of components) {
    const cssBlocks = extractCssBlocks(content);
    if (cssBlocks.length === 0) continue;

    it(`${name} :host does not declare theme CSS custom properties`, () => {
      for (const css of cssBlocks) {
        let hostMatch;
        const hostRegex = /:host\s*\{([^}]*)\}/g;
        while ((hostMatch = hostRegex.exec(css)) !== null) {
          const hostBody = hostMatch[1];
          const propMatches = hostBody.match(CUSTOM_PROP_DECL) || [];
          for (const prop of propMatches) {
            const propName = prop.replace(/\s*:$/, '');
            const isThemeVar = THEME_VAR_PREFIXES.some((prefix) => propName.startsWith(prefix));
            expect(
              isThemeVar,
              `${name} :host declares theme variable "${propName}" which shadows document-level power mode values`,
            ).toBe(false);
          }
        }
      }
    });
  }
});
