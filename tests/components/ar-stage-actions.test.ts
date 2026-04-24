import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #78 — Inline error-stage actions in ar-progress.
 */

const ROOT = resolve(__dirname, '..', '..');
const PROG = readFileSync(resolve(ROOT, 'src/components/ar-progress.ts'), 'utf8');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('inline error-stage actions (#78)', () => {
  it('ar-progress renders retry / report / reload buttons when a stage errors', () => {
    expect(PROG).toMatch(/s\.status === ['"]error['"]/);
    expect(PROG).toMatch(/class="stage-action stage-action-retry"/);
    expect(PROG).toMatch(/class="stage-action stage-action-report"/);
    expect(PROG).toMatch(/class="stage-action stage-action-reload"/);
    expect(PROG).toMatch(/t\(['"]error\.retry['"]\)/);
    expect(PROG).toMatch(/t\(['"]error\.report['"]\)/);
    expect(PROG).toMatch(/t\(['"]error\.reload['"]\)/);
  });

  it('ar-progress delegates clicks to composed CustomEvents (retry/report) and reloads directly', () => {
    expect(PROG).toMatch(/ar:stage-retry[\s\S]*?bubbles: true,\s*composed: true/);
    expect(PROG).toMatch(/ar:stage-report[\s\S]*?bubbles: true,\s*composed: true/);
    expect(PROG).toMatch(/stage-action-reload[\s\S]*?location\.reload\(\)/);
  });

  it('retry button gets the accent-primary variant', () => {
    expect(PROG).toMatch(/\.stage-action-retry \{[\s\S]*?color: var\(--color-accent-primary/);
  });

  it('ar-app wires ar:stage-retry -> retryFromError and ar:stage-report -> GitHub issue URL', () => {
    expect(APP).toMatch(/ar:stage-retry[\s\S]*?retryFromError\(\)/);
    expect(APP).toMatch(/ar:stage-report[\s\S]*?github\.com\/yocreoquesi\/nukebg\/issues\/new\?title=/);
    // Body embeds UA + locale for debugging
    expect(APP).toMatch(/encodeURIComponent\(navigator\.userAgent\)/);
  });

  it('i18n parity — error.retry / error.report / error.reload in all six locales', () => {
    for (const key of ['error.retry', 'error.report', 'error.reload']) {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length, key).toBe(6);
    }
  });

  it('coarse-pointer bumps .stage-action to ≥ 40 px min-height', () => {
    expect(PROG).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.stage-action \{ min-height: 40px/);
  });
});
