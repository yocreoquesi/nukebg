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
    .filter(f => f.endsWith('.ts'))
    .map(f => ({ name: join(dir, f), content: readFileSync(resolve(absDir, f), 'utf8') }));
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
  '#00ff41',  // --color-accent-primary / --color-text-primary
  '#00dd44',  // --color-text-secondary
  '#008830',  // --color-text-tertiary
  '#1a3a1a',  // --color-surface-border
  '#ffd700',  // old --color-accent (no longer exists)
];

// Allowed contexts where these hex values appear as CSS variable FALLBACKS
// e.g. var(--color-accent-primary, #00ff41) is fine
const VAR_FALLBACK_PATTERN = /var\(\s*--[\w-]+\s*,\s*([^)]+)\)/g;

/** Remove var() fallback values from CSS so they don't trigger false positives */
function stripVarFallbacks(css: string): string {
  return css.replace(VAR_FALLBACK_PATTERN, 'var(--STRIPPED)');
}

// ── Power Mode Variable Completeness ─────────────────────────────────

/** All CSS variables that MUST be set in every non-Normal power mode */
const REQUIRED_MODE_VARS = [
  '--terminal-color-override',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-accent-primary',
  '--color-accent-rgb',
  '--color-accent-glow',
  '--color-accent-muted',
  '--color-accent-hover',
  '--color-surface-border',
  '--color-surface-hover',
  '--color-surface-active',
  '--color-success',
  '--color-info',
];

/** All CSS variables that MUST be removed in Normal mode */
const REQUIRED_REMOVE_VARS = REQUIRED_MODE_VARS;

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
          expect(
            matches,
            `Found hardcoded rgba(0,255,65,...) in ${name} CSS`,
          ).toHaveLength(0);
        }
      });

      it('CSS has no bare rgba(255, 215, 0, ...) (old gold accent)', () => {
        for (const css of cssBlocks) {
          const regex = /rgba\(\s*255\s*,\s*215\s*,\s*0/gi;
          const matches = stripped(css).match(regex) || [];
          expect(
            matches,
            `Found hardcoded rgba(255,215,0,...) in ${name} CSS`,
          ).toHaveLength(0);
        }

        function stripped(css: string) { return stripVarFallbacks(css); }
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

describe('color consistency — power modes set all required variables', () => {
  const appTs = read('src/components/ar-app.ts');

  // Extract each mode block by looking for the setProperty calls
  const modes = [
    { name: 'Full Nuke', marker: "Mode: FULL NUKE" },
    { name: 'High Power', marker: "Mode: HIGH POWER" },
    { name: 'Low Power', marker: "Mode: LOW POWER" },
  ];

  for (const mode of modes) {
    describe(`${mode.name} mode`, () => {
      // Find the block between this mode's marker and the next mode/else
      const markerIdx = appTs.indexOf(mode.marker);
      expect(markerIdx).toBeGreaterThan(-1);

      // Get a chunk around the marker (the mode block is ~40 lines)
      const blockStart = appTs.lastIndexOf('} else if', markerIdx) !== -1
        ? appTs.lastIndexOf('if (val ===', markerIdx)
        : appTs.lastIndexOf('if (val ===', markerIdx);
      const blockEnd = appTs.indexOf('} else', markerIdx + 1);
      const block = appTs.slice(
        blockStart > 0 ? blockStart : markerIdx - 500,
        blockEnd > 0 ? blockEnd : markerIdx + 1500,
      );

      for (const varName of REQUIRED_MODE_VARS) {
        it(`sets ${varName}`, () => {
          expect(
            block,
            `${mode.name} mode does not set ${varName}`,
          ).toContain(`'${varName}'`);
        });
      }
    });
  }

  describe('Normal mode', () => {
    const normalMarker = "Mode: NORMAL";
    const markerIdx = appTs.indexOf(normalMarker);
    expect(markerIdx).toBeGreaterThan(-1);

    const blockStart = appTs.lastIndexOf('else {', markerIdx);
    const blockEnd = appTs.indexOf('}, { signal }', markerIdx);
    const block = appTs.slice(
      blockStart > 0 ? blockStart : markerIdx - 500,
      blockEnd > 0 ? blockEnd : markerIdx + 1500,
    );

    for (const varName of REQUIRED_REMOVE_VARS) {
      it(`removes ${varName}`, () => {
        expect(
          block,
          `Normal mode does not remove ${varName}`,
        ).toContain(`'${varName}'`);
      });
    }
  });
});

describe('color consistency — no non-existent CSS variables', () => {
  const components = readComponentFiles('src/components');
  // var(--color-accent, ...) was a common mistake — this variable doesn't exist
  const GHOST_VARS = [
    '--color-accent,',  // trailing comma = used as var(--color-accent, fallback)
  ];

  for (const { name, content } of components) {
    for (const ghost of GHOST_VARS) {
      it(`${name} does not reference non-existent ${ghost.replace(',', '')}`, () => {
        expect(content).not.toContain(ghost);
      });
    }
  }
});
