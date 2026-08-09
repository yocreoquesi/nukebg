import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Quiet-mode toggle (#79) was removed in #148.
 *
 * After the Reactor pivot (#113) and smoke cleanup (#118), the toggle
 * stopped gating any visual effect except the slider reveal animation
 * in ar-viewer — which is already covered by `prefers-reduced-motion`.
 * The button promised to silence things that no longer exist, so it
 * was removed entirely.
 *
 * These tests guard the removal so the toggle doesn't sneak back in.
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const VIEWER = readFileSync(resolve(ROOT, 'src/components/ar-viewer.ts'), 'utf8');
const HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'src/styles/main.css'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('playful / quiet mode — removed (#148)', () => {
  it('ar-app no longer ships the playful gating helpers', () => {
    expect(APP).not.toMatch(/isPlayful\(\)/);
    expect(APP).not.toMatch(/setPlayfulMode/);
    expect(APP).not.toMatch(/resolvePlayfulMode/);
    expect(APP).not.toMatch(/syncQuietModeToggle/);
    expect(APP).not.toMatch(/nukebg:playful/);
  });

  it('ar-app no longer carries the .crt-word-flicker rule that was its only CSS gate', () => {
    expect(APP).not.toMatch(/\.crt-word-flicker/);
  });

  it('ar-viewer slider reveal still respects prefers-reduced-motion', () => {
    expect(VIEWER).toMatch(/window\.matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/);
    expect(VIEWER).not.toMatch(/dataset\.playful/);
  });

  it('index.html no longer renders the quiet-mode toggle', () => {
    expect(HTML).not.toMatch(/quiet-mode-toggle/);
    expect(HTML).not.toMatch(/footer-quiet-btn/);
  });

  it('main.css no longer styles .footer-quiet-btn', () => {
    expect(CSS).not.toMatch(/\.footer-quiet-btn/);
  });

  it('i18n no longer ships footer.quietMode / footer.playfulMode', () => {
    expect(I18N).not.toMatch(/'footer\.quietMode'/);
    expect(I18N).not.toMatch(/'footer\.playfulMode'/);
  });
});
