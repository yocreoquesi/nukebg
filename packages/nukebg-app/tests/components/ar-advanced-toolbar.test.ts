import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #346 — the advanced editor adopts the shell ar-editor.ts already ships:
 * a command bar on top, then a rail | canvas | sidebar grid behind the
 * 900 px breakpoint.
 *
 * Replaces the #77 two-row-toolbar assertions. That layout is gone, so
 * the tests that pinned it are rewritten rather than deleted: every
 * invariant #77 protected — the size slider staying mounted across tool
 * changes, the contextual row collapsing when empty — is re-asserted
 * here against the new structure.
 */

const ROOT = resolve(__dirname, '..', '..');
const ED = readFileSync(resolve(ROOT, 'src/components/ar-editor-advanced.ts'), 'utf8');
const SIMPLE = readFileSync(resolve(ROOT, 'src/components/ar-editor.ts'), 'utf8');

describe('ar-editor-advanced — editor shell (#346)', () => {
  it('renders a command bar carrying zoom, undo/redo and the session verbs', () => {
    const bar = ED.match(/<div class="editor-cmd-bar">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(bar).not.toBeNull();
    expect(bar![0]).toMatch(/class="zoom-group"/);
    expect(bar![0]).toMatch(/id="undo"/);
    expect(bar![0]).toMatch(/id="redo"/);
    expect(bar![0]).toMatch(/id="cancel"/);
    expect(bar![0]).toMatch(/id="done"/);
  });

  it('the command-bar status line is present and driven by syncCmdBar', () => {
    expect(ED).toMatch(/id="adv-cmd-action"/);
    expect(ED).toMatch(/id="adv-cmd-meta"/);
    // It must be updated, not static — a status line that lies is worse
    // than no status line.
    expect(ED).toMatch(/private syncCmdBar\(\): void/);
    expect(ED).toMatch(/action\.textContent = `edit --\$\{this\.tool\}`/);
  });

  it('renders the three shell regions inside .editor-body', () => {
    const body = ED.match(/<div class="editor-body">[\s\S]*?<div class="controls">/);
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/<aside class="editor-rail"/);
    expect(body![0]).toMatch(/<div class="editor-canvas-col">/);
    expect(body![0]).toMatch(/<aside class="editor-sidebar">/);
  });

  it('rail carries tool + size + background; not the zoom group', () => {
    const rail = ED.match(/<aside class="editor-rail"[\s\S]*?<\/aside>/);
    expect(rail).not.toBeNull();
    expect(rail![0]).toMatch(/class="tool-group"/);
    expect(rail![0]).toMatch(/id="size-row"/);
    expect(rail![0]).toMatch(/class="bg-options"/);
    expect(rail![0]).not.toMatch(/class="zoom-group"/);
  });

  it('sidebar carries restore / reprocess / help, so touch keeps them (no display:none)', () => {
    const sidebar = ED.match(/<aside class="editor-sidebar">[\s\S]*?<\/aside>/);
    expect(sidebar).not.toBeNull();
    expect(sidebar![0]).toMatch(/id="restore-original"/);
    expect(sidebar![0]).toMatch(/id="reprocess"/);
    expect(sidebar![0]).toMatch(/id="help-toggle"/);
    // ar-editor.ts hides its sidebar below 900px because it only mirrors
    // the "?" tooltip. This one holds real actions, so it must not.
    expect(ED).not.toMatch(/\.editor-sidebar \{[^}]*display: none/);
  });

  it('contextual strip sits under the canvas and holds the lasso + preview groups', () => {
    const col = ED.match(/<div class="editor-canvas-col">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(col).not.toBeNull();
    expect(col![0]).toMatch(/class="canvas-wrap"/);
    const ctx = ED.match(/<div class="editor-context">[\s\S]*?id="preview-actions"/);
    expect(ctx).not.toBeNull();
    expect(ctx![0]).toMatch(/id="lasso-actions"/);
  });

  it('contextual strip collapses when neither child carries .visible (kept from #77)', () => {
    expect(ED).toMatch(/\.editor-context:not\(:has\(> \.visible\)\) \{[\s\S]*?display: none/);
  });

  it('size slider stays mounted for every tool, disabled rather than removed (kept from #77)', () => {
    // #77's no-layout-shift guarantee: switching to lasso must not
    // unmount the slider, only dim it.
    expect(ED).toMatch(/sizeRow\.classList\.toggle\('disabled', this\.tool === 'lasso'\)/);
    expect(ED).toMatch(/\.size-row\.disabled \{[\s\S]*?pointer-events: none/);
  });

  it('uses the same grid ar-editor.ts defines, so both editors share one layout', () => {
    const grid = /grid-template-columns: 200px minmax\(0, 1fr\) 260px/;
    expect(ED).toMatch(grid);
    expect(SIMPLE).toMatch(grid);
  });

  it('the two-row toolbar from #77 is fully gone', () => {
    // Matched as markup and CSS rules, never as prose — the comments
    // that explain what the old structure was are worth keeping, and a
    // test that fails on a comment is a test nobody trusts.
    expect(ED).not.toMatch(/class="toolbar-row/);
    expect(ED).not.toMatch(/\.toolbar-row-primary\s*\{/);
    expect(ED).not.toMatch(/\.toolbar-row-contextual[\s:]*[{(]/);
    expect(ED).not.toMatch(/<div class="toolbar">/);
    expect(ED).not.toMatch(/^\s*\.toolbar\s*\{/m);
  });

  it('on touch the rail becomes the fixed bottom dock the old toolbar was', () => {
    expect(ED).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.editor-rail \{[\s\S]*?position: fixed/,
    );
  });
});
