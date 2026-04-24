import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'public/manifest.webmanifest'), 'utf8'),
);
const MAIN = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');

describe('PWA manifest — install experience', () => {
  it('declares a stable id + lang + dir', () => {
    expect(MANIFEST.id).toBe('/');
    expect(MANIFEST.lang).toBe('en');
    expect(MANIFEST.dir).toBe('ltr');
  });

  it('opts into richer display modes via display_override', () => {
    expect(Array.isArray(MANIFEST.display_override)).toBe(true);
    expect(MANIFEST.display_override).toContain('window-controls-overlay');
    expect(MANIFEST.display_override).toContain('standalone');
    expect(MANIFEST.display).toBe('standalone');
  });

  it('uses launch_handler.client_mode focus-existing so a second launch reuses the open instance', () => {
    expect(MANIFEST.launch_handler).toBeTruthy();
    expect(MANIFEST.launch_handler.client_mode).toContain('focus-existing');
  });

  it('declares handle_links preferred + prefer_related_applications false + edge_side_panel', () => {
    expect(MANIFEST.handle_links).toBe('preferred');
    expect(MANIFEST.prefer_related_applications).toBe(false);
    expect(MANIFEST.edge_side_panel).toBeTruthy();
    expect(typeof MANIFEST.edge_side_panel.preferred_width).toBe('number');
  });

  it('exposes app shortcuts for "new image" and "keyboard shortcuts"', () => {
    expect(Array.isArray(MANIFEST.shortcuts)).toBe(true);
    expect(MANIFEST.shortcuts.length).toBeGreaterThanOrEqual(2);
    const urls = MANIFEST.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toContain('/?action=new');
    expect(urls).toContain('/?help=1');
    for (const s of MANIFEST.shortcuts) {
      expect(s.name).toBeTruthy();
      expect(Array.isArray(s.icons)).toBe(true);
      expect(s.icons.length).toBeGreaterThan(0);
    }
  });

  it('main.ts wires a deep-link handler that consumes ?help=1 and ?action=new', () => {
    expect(MAIN).toMatch(/function initDeepLinks\(\)/);
    expect(MAIN).toMatch(/^\s*initDeepLinks\(\);\s*$/m);
    expect(MAIN).toMatch(/params\.get\(['"]help['"]\) === ['"]1['"]/);
    expect(MAIN).toMatch(/params\.get\(['"]action['"]\) === ['"]new['"]/);
    expect(MAIN).toMatch(/new KeyboardEvent\(['"]keydown['"], \{ key: ['"]\?['"]/);
    expect(MAIN).toMatch(/new KeyboardEvent\(['"]keydown['"], \{ key: ['"]\/['"]/);
  });
});
