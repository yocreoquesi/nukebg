import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #76 sub-task B — permanent shortcuts sidebar on the basic editor.
 * Source invariants: sidebar + shortcuts exist, the ? popover hides
 * at ≥ 900 px, sidebar only shows at ≥ 900 px.
 */

const ROOT = resolve(__dirname, '..', '..');
const ED = readFileSync(resolve(ROOT, 'src/components/ar-editor.ts'), 'utf8');

describe('ar-editor — permanent shortcuts sidebar (#76-B)', () => {
  it('renders an <aside class="editor-sidebar"> with shortcuts list', () => {
    expect(ED).toMatch(/<aside class="editor-sidebar"[^>]*aria-labelledby="ed-shortcuts-title"/);
    expect(ED).toMatch(/<h4 id="ed-shortcuts-title">\$\{t\(['"]editor\.shortcuts['"]\)\}<\/h4>/);
    expect(ED).toMatch(/<div class="editor-shortcuts">/);
  });

  it('sidebar contains all seven shortcut rows from the popover', () => {
    expect(ED).toMatch(/t\(['"]editor\.shortcutErase['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutEraserSize['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutZoom['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutPan['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutResetView['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutUndo['"]\)/);
    expect(ED).toMatch(/t\(['"]editor\.shortcutRedo['"]\)/);
  });

  it('canvas is wrapped in .editor-body alongside the sidebar', () => {
    const m = ED.match(/<div class="editor-body">[\s\S]*?<\/aside>\s*<\/div>/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/class="canvas-wrap"/);
    expect(m![0]).toMatch(/class="editor-sidebar"/);
  });

  it('CSS hides the sidebar under 900 px and shows it at/over the breakpoint', () => {
    expect(ED).toMatch(/\.editor-sidebar \{[\s\S]*?display: none;/);
    expect(ED).toMatch(
      /@media \(min-width: 900px\) \{[\s\S]*?\.editor-sidebar \{ display: flex; \}/,
    );
  });

  it('CSS hides .help-wrap popover at ≥ 900 px (sidebar owns shortcuts)', () => {
    expect(ED).toMatch(
      /@media \(min-width: 900px\) \{[\s\S]*?\.help-wrap \{ display: none; \}/,
    );
  });

  it('.editor-body becomes a multi-col grid at ≥ 900 px', () => {
    expect(ED).toMatch(/\.editor-body \{[\s\S]*?display: grid/);
    // Sub-task A added a left rail so the grid is now 3-col
    // (200 px rail | fluid canvas | 260 px sidebar) instead of 2-col.
    expect(ED).toMatch(
      /@media \(min-width: 900px\) \{[\s\S]*?\.editor-body \{[\s\S]*?grid-template-columns: 200px minmax\(0, 1fr\) 260px/,
    );
  });
});
