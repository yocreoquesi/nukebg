import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * CSS token integrity.
 *
 * color-consistency.test.ts audits the *value* side of theming: it forbids a
 * raw `#00ff41` from bypassing the variable system. It never audits the *name*
 * side, so `var(--color-text, #ddd)` sails through — the fallback is stripped
 * before the check, and `--color-text` is not defined anywhere.
 *
 * That gap shipped four undefined tokens into ar-editor-advanced.ts, which
 * therefore rendered grey fallbacks and ignored all six themes from
 * `:root[data-theme=...]`. Undefined custom properties are valid CSS, so
 * neither the compiler nor ESLint can catch this — only a test can.
 *
 * Rule: every `var(--color-*)` a component references must be defined in
 * main.css, or declared locally in that component's own CSS.
 */

const root = resolve(__dirname, '..');

/** Mirrors color-consistency.test.ts: a *.styles.ts module IS the stylesheet. */
function extractCssBlocks(source: string, name: string): string[] {
  if (/\.styles\.ts$/.test(name)) return [source];

  const blocks: string[] = [];
  const regex = /<style>([\s\S]*?)<\/style>/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function readComponentFiles(dir: string): { name: string; content: string }[] {
  const absDir = resolve(root, dir);
  return readdirSync(absDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: join(dir, f), content: readFileSync(resolve(absDir, f), 'utf8') }));
}

/** Collect every `--name` declared as a custom property in a CSS source. */
function declaredProps(css: string): Set<string> {
  const names = new Set<string>();
  const regex = /(--[\w-]+)\s*:/g;
  let match;
  while ((match = regex.exec(css)) !== null) names.add(match[1]);
  return names;
}

/** Collect every `--color-*` name read through var(). */
function usedColorVars(css: string): string[] {
  const names: string[] = [];
  const regex = /var\(\s*(--color-[\w-]+)/g;
  let match;
  while ((match = regex.exec(css)) !== null) names.push(match[1]);
  return names;
}

const mainCss = readFileSync(resolve(root, 'src/styles/main.css'), 'utf8');
const globalProps = declaredProps(mainCss);

describe('css token integrity — every var(--color-*) resolves to a real definition', () => {
  it('main.css actually defines the core palette (guards the guard)', () => {
    // If this fails the parser is broken, not the components.
    expect(globalProps.has('--color-accent-primary')).toBe(true);
    expect(globalProps.has('--color-text-tertiary')).toBe(true);
    expect(globalProps.has('--color-surface-border')).toBe(true);
  });

  const components = readComponentFiles('src/components');

  for (const { name, content } of components) {
    const cssBlocks = extractCssBlocks(content, name);
    if (cssBlocks.length === 0) continue;

    it(`${name} references no undefined --color-* token`, () => {
      const undefinedTokens = new Set<string>();

      for (const css of cssBlocks) {
        const localProps = declaredProps(css);
        for (const used of usedColorVars(css)) {
          if (!globalProps.has(used) && !localProps.has(used)) undefinedTokens.add(used);
        }
      }

      expect(
        [...undefinedTokens],
        `${name} reads CSS variables that are never defined, so they silently fall back to their ` +
          `literal fallback and stop following the theme:\n  ${[...undefinedTokens].join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
