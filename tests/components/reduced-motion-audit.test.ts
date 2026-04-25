import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #35 — Ensure every component that ships an animation (@keyframes in
 * its inline <style>) also carries a `prefers-reduced-motion: reduce`
 * guard that turns it off, and that the viewer's JS-driven slider
 * reveal respects both reduced-motion and the user-toggled quiet mode.
 */

const ROOT = resolve(__dirname, '..', '..');
const COMPONENTS = [
  'ar-app.ts',
  'ar-editor.ts',
  'ar-editor-advanced.ts',
  'ar-dropzone.ts',
  'ar-batch-item.ts',
  'ar-progress.ts',
  'ar-viewer.ts',
];

describe('reduced-motion audit (#35)', () => {
  for (const f of COMPONENTS) {
    const src = readFileSync(resolve(ROOT, 'src/components', f), 'utf8');
    it(`${f}: every @keyframes owner has a prefers-reduced-motion guard`, () => {
      const hasKeyframes = /@keyframes/.test(src);
      if (!hasKeyframes) return;
      expect(src, `${f} declares keyframes but no prefers-reduced-motion guard`).toMatch(
        /@media \(prefers-reduced-motion: reduce\)/,
      );
    });
  }

  it('ar-viewer slider reveal skips when reduced-motion OR quiet-mode is active', () => {
    const v = readFileSync(resolve(ROOT, 'src/components/ar-viewer.ts'), 'utf8');
    expect(v).toMatch(/matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/);
    expect(v).toMatch(/document\.documentElement\.dataset\.playful === ['"]false['"]/);
    expect(v).toMatch(/if \(reducedMotion \|\| quietMode\)/);
  });

  it('ar-app defaults data-playful="false" when OS reports reduced-motion', () => {
    const a = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
    expect(a).toMatch(
      /reducedMotion = window\.matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/,
    );
    expect(a).toMatch(/dataset\.playful = reducedMotion \? ['"]false['"] : ['"]true['"]/);
  });

  it('ar-editor-advanced gates hint-pulse under reduced-motion', () => {
    const e = readFileSync(resolve(ROOT, 'src/components/ar-editor-advanced.ts'), 'utf8');
    expect(e).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.hint \{ animation: none/,
    );
  });
});
