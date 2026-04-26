import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Partial close of #35: keyboard/AT access for the three interactive
 * canvases (basic editor, advanced editor, before/after viewer) and
 * WAI-ARIA slider step behaviour on the viewer handle.
 */

const ROOT = resolve(__dirname, '..', '..');
const EDITOR = readFileSync(resolve(ROOT, 'src/components/ar-editor.ts'), 'utf8');
const ADV = readFileSync(resolve(ROOT, 'src/components/ar-editor-advanced.ts'), 'utf8');
const VIEWER = readFileSync(resolve(ROOT, 'src/components/ar-viewer.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('editor canvas — focusable + described (#35)', () => {
  it('ar-editor canvas carries tabindex=0, role=img, and editor.canvasLabel', () => {
    expect(EDITOR).toMatch(
      /<canvas id="editor-canvas" tabindex="0" role="img"[\s\S]*?aria-label="\$\{t\(['"]editor\.canvasLabel['"]\)\}"/,
    );
  });

  it('ar-editor-advanced canvas carries tabindex=0, role=img, and advanced.canvasLabel', () => {
    expect(ADV).toMatch(
      /<canvas tabindex="0" role="img"[\s\S]*?aria-label="\$\{t\(['"]advanced\.canvasLabel['"]\)\}"/,
    );
  });
});

describe('viewer slider — WAI-ARIA keyboard steps (#35)', () => {
  it('handle is a role=slider with valuemin/valuemax/valuenow', () => {
    expect(VIEWER).toMatch(
      /role="slider"[\s\S]*?aria-valuenow=[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"/,
    );
    expect(VIEWER).toMatch(
      /aria-label="\$\{t\(['"]viewer\.original['"]\)\} \/ \$\{t\(['"]viewer\.result['"]\)\}"/,
    );
  });

  it('supports ±2 / ±10 / Home / End / PageUp / PageDown per WAI-ARIA slider spec', () => {
    const keymap = VIEWER.match(/const step = e\.shiftKey[\s\S]*?\}\s*if \(handled\)/);
    expect(keymap, 'slider key handler not found').not.toBeNull();
    const block = keymap![0];
    expect(block).toMatch(/e\.shiftKey \? 10 : 2/);
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
    ]) {
      expect(block).toContain(`case '${key}':`);
    }
  });

  it('Home jumps to 0 and End jumps to 100', () => {
    expect(VIEWER).toMatch(/case ['"]Home['"]:[\s\S]*?this\.sliderPos = 0;/);
    expect(VIEWER).toMatch(/case ['"]End['"]:[\s\S]*?this\.sliderPos = 100;/);
  });
});

describe('i18n — editor.canvasLabel + advanced.canvasLabel', () => {
  it('ships translations for all six locales', () => {
    const edCount = (I18N.match(/'editor\.canvasLabel':/g) || []).length;
    const advCount = (I18N.match(/'advanced\.canvasLabel':/g) || []).length;
    expect(edCount).toBe(6);
    expect(advCount).toBe(6);
  });
});
