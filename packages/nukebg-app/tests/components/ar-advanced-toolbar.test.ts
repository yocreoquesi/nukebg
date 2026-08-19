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
    expect(ED).toMatch(/\.size-row\.disabled[,\s][\s\S]*?pointer-events: none/);
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

/**
 * #346 slice 4 — the preview confirm pair, and the keys that drive it.
 *
 * The defect being closed: two controls labelled Apply could be on
 * screen at once, one committing a previewed lasso operation and one
 * committing the whole session. The fix is shape, not just wording —
 * keycaps next to plain buttons — plus Enter and Escape actually doing
 * the two things.
 */
describe('ar-editor-advanced — preview confirm pair (#346)', () => {
  it('renders the confirm pair as keycaps, not as peer word buttons', () => {
    const row = ED.match(/id="preview-actions"[\s\S]*?<\/div>/);
    expect(row).not.toBeNull();
    expect(row![0]).toMatch(/class="key-btn confirm"[^>]*id="action-apply-preview"/);
    expect(row![0]).toMatch(/class="key-btn danger"[^>]*id="action-cancel-preview"/);
    // The keycap glyph is what separates them from the session buttons
    // before anything is read.
    expect(row![0]).toMatch(/<kbd aria-hidden="true">&crarr;<\/kbd>/);
    expect(row![0]).toMatch(/<kbd aria-hidden="true">esc<\/kbd>/);
    // They must not reuse .action-btn, whose uppercase transform and
    // solid hover would make them look like the lasso actions again.
    expect(row![0]).not.toMatch(/class="action-btn[^"]*"[^>]*id="action-apply-preview"/);
  });

  it('keeps the pair tappable on touch — a keyboard-only answer would be worse', () => {
    expect(ED).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.key-btn \{[\s\S]*?min-height: 44px/);
  });

  it('Enter commits a pending preview and is inert otherwise', () => {
    const handler = ED.match(/if \(e\.key === 'Enter'\) \{[\s\S]*?\n {8}\}/);
    expect(handler).not.toBeNull();
    expect(handler![0]).toMatch(/if \(!this\.pendingPreview \|\| this\.busy\) return;/);
    expect(handler![0]).toMatch(/this\.applyPreview\(\)/);
  });

  it('Escape drops the preview BEFORE it clears the lasso', () => {
    const esc = ED.match(/if \(e\.key === 'Escape'\) \{[\s\S]*?\n {10}return;\n {8}\}/);
    expect(esc).not.toBeNull();
    const body = esc![0];
    const preview = body.indexOf('this.cancelPreview()');
    const clear = body.indexOf('this.clearLasso()');
    expect(preview).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    // Order is the invariant: one Escape drops the previewed change and
    // leaves the selection standing, a second Escape clears it. Swapping
    // these silently destroys the user's lasso on the first press.
    expect(preview).toBeLessThan(clear);
    // And the busy branch still wins over both.
    expect(body.indexOf('this.cancelAction()')).toBeLessThan(preview);
  });
});

describe('ar-editor-advanced — lasso actions are ranked (#346)', () => {
  it('leads with Refine and fences Erase object behind a separator', () => {
    const row = ED.match(/id="lasso-actions"[\s\S]*?id="cancel-action"/);
    expect(row).not.toBeNull();
    const body = row![0];
    const order = [
      'action-refine',
      'action-crop',
      'action-remove-watermark',
      'action-erase-object',
    ];
    const positions = order.map((id) => body.indexOf(id));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // The destructive one sits after the rule, not among the others.
    expect(body.indexOf('action-sep')).toBeLessThan(body.indexOf('action-erase-object'));
    expect(body.indexOf('action-sep')).toBeGreaterThan(body.indexOf('action-remove-watermark'));
    expect(body).toMatch(/class="action-btn lead"[^>]*id="action-refine"/);
    expect(body).toMatch(/class="action-btn danger"[^>]*id="action-erase-object"/);
  });
});

/**
 * #346 slice 5a — brush shape ported from ar-editor.ts.
 *
 * The UI-level toggle is covered behaviourally in ar-editor-advanced.test.ts.
 * What that cannot reach is whether the paint routines actually honour the
 * shape, which is the part that would make the port cosmetic if it broke.
 */
describe('ar-editor-advanced — brush shape reaches the pixels (#346)', () => {
  it('the stroke routine branches on shape for both eraser and brush', () => {
    const fn = ED.match(/private applyStrokeSegment\([\s\S]*?\n {2}\}/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/const square = this\.brushShape === 'square';/);
    // Eraser: butt caps and mitred joins, or the stroke rounds its own ends off.
    expect(body).toMatch(/lineCap = square \? 'butt' : 'round'/);
    expect(body).toMatch(/lineJoin = square \? 'miter' : 'round'/);
    // Butt caps leave the ends open, so a single click must still stamp.
    expect(body).toMatch(/fillRect\(fromX - r, fromY - r, r \* 2, r \* 2\)/);
    // Brush: clip to a rect instead of an arc.
    expect(body).toMatch(/wctx\.rect\(cx - r, cy - r, r \* 2, r \* 2\)/);
    expect(body).toMatch(/wctx\.arc\(cx, cy, r, 0, Math\.PI \* 2\)/);
  });

  it('the on-canvas cursor shows the shape it will paint with', () => {
    expect(ED).toMatch(/if \(this\.brushShape === 'square'\) \{[\s\S]*?this\.ctx\.rect\(/);
  });

  it('shape dims with size when lasso is active, rather than disappearing', () => {
    expect(ED).toMatch(/shapeRow\.classList\.toggle\('disabled', this\.tool === 'lasso'\)/);
    expect(ED).toMatch(/#shape-row\.disabled[\s\S]*?pointer-events: none/);
  });

  it('reuses the editor.* shape keys that already exist in all six locales', () => {
    // Zero translation churn: ar-editor.ts already shipped these.
    expect(ED).toMatch(/t\('editor\.shape'\)/);
    expect(ED).toMatch(/t\('editor\.eraserCircle'\)/);
    expect(ED).toMatch(/t\('editor\.eraserSquare'\)/);
  });
});
