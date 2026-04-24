import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source invariants for the global keyboard shortcut layer in
 * src/main.ts — the `/` focus-dropzone binding, `?` overlay toggle,
 * Esc dismiss, and the Ctrl+S download path that must target the
 * post-#72 `#dl-png` anchor (not the legacy `#download-btn`).
 */

const ROOT = resolve(__dirname, '..', '..');
const MAIN = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'src/styles/main.css'), 'utf8');

describe('global keyboard shortcuts (src/main.ts)', () => {
  it('initKeyboardShortcuts is declared and invoked at bootstrap', () => {
    expect(MAIN).toMatch(/function initKeyboardShortcuts\(\): void/);
    expect(MAIN).toMatch(/^\s*initKeyboardShortcuts\(\);\s*$/m);
  });

  it('creates and mounts the shortcut overlay on document.body', () => {
    expect(MAIN).toMatch(/function createShortcutOverlay\(\): HTMLDivElement/);
    expect(MAIN).toMatch(/document\.body\.appendChild\(overlay\)/);
    expect(MAIN).toMatch(/overlay\.className = ['"]kbd-overlay['"]/);
    expect(MAIN).toMatch(/role['"],\s*['"]dialog['"]/);
    expect(MAIN).toMatch(/aria-modal['"],\s*['"]true['"]/);
  });

  it('Ctrl+S targets the post-#72 #dl-png anchor, not the legacy #download-btn', () => {
    expect(MAIN).toMatch(/#dl-png/);
    expect(MAIN).not.toMatch(/#download-btn/);
  });

  it('`/` focuses ar-dropzone .dropzone', () => {
    expect(MAIN).toMatch(/e\.key === ['"]\/['"]/);
    expect(MAIN).toMatch(/querySelector\(['"]ar-dropzone['"]\)/);
    expect(MAIN).toMatch(/querySelector\(['"]\.dropzone['"]\)/);
  });

  it('`?` toggles the overlay and Esc closes it', () => {
    expect(MAIN).toMatch(/e\.key === ['"]\?['"]/);
    expect(MAIN).toMatch(/overlay\.hidden \? openOverlay\(\) : closeOverlay\(\)/);
    expect(MAIN).toMatch(/e\.key === ['"]Escape['"] && !overlay\.hidden/);
  });

  it('skips non-ctrl bindings when the user is typing in a form field', () => {
    expect(MAIN).toMatch(/const inFormField = /);
    expect(MAIN).toMatch(/isContentEditable/);
    expect(MAIN).toMatch(/if \(inFormField\(e\.target\)\) return;/);
  });

  it('overlay cheat-sheet lists every global + reactor + editor binding', () => {
    for (const k of ['/', 'Ctrl', 'Esc', '\\?', 'B', 'E', '\\[', '\\]', '0', 'Z', 'Alt', '1', '2', '3', '4']) {
      expect(MAIN).toMatch(new RegExp(`<kbd>${k}</kbd>`));
    }
  });

  it('Alt+1..4 clicks the matching reactor segment', () => {
    expect(MAIN).toMatch(/e\.altKey && !e\.ctrlKey && !e\.metaKey/);
    expect(MAIN).toMatch(/\['1', '2', '3', '4'\]\.includes\(e\.key\)/);
    expect(MAIN).toMatch(/\.reactor-segment\[data-precision="\$\{level\}"/);
    expect(MAIN).toMatch(/seg\.click\(\)/);
  });

  it('main.css defines .kbd-overlay with a high z-index so it sits over every shadow tree', () => {
    expect(CSS).toMatch(/\.kbd-overlay \{[\s\S]*?position: fixed;[\s\S]*?z-index:\s*10000;/);
    expect(CSS).toMatch(/\.kbd-overlay\[hidden\] \{ display: none; \}/);
    expect(CSS).toMatch(/\.kbd-overlay-card \{/);
    expect(CSS).toMatch(/\.kbd-overlay-close \{/);
  });
});
