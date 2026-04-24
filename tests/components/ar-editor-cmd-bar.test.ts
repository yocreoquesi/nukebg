import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #76 sub-task C — editor mini command bar source invariants.
 */

const ROOT = resolve(__dirname, '..', '..');
const ED = readFileSync(resolve(ROOT, 'src/components/ar-editor.ts'), 'utf8');

describe('ar-editor — mini command bar (#76-C)', () => {
  it('renders <div class="editor-cmd-bar"> above .editor-body', () => {
    const rx = /<div class="editor-cmd-bar">[\s\S]*?<div class="editor-body">/;
    expect(ED).toMatch(rx);
  });

  it('command bar has prompt + action + live meta + Cancel + Apply', () => {
    const bar = ED.match(/<div class="editor-cmd-bar">[\s\S]*?<\/div>\s*<div class="editor-body">/);
    expect(bar).not.toBeNull();
    expect(bar![0]).toMatch(/class="editor-cmd-prompt">\$</);
    expect(bar![0]).toMatch(/class="editor-cmd-action">edit --brush</);
    expect(bar![0]).toMatch(/id="editor-cmd-meta"/);
    expect(bar![0]).toMatch(/id="cancel-btn"/);
    expect(bar![0]).toMatch(/id="done-btn"/);
  });

  it('Apply button uses the primary modifier; Cancel uses the neutral variant', () => {
    const bar = ED.match(/<div class="editor-cmd-bar">[\s\S]*?<\/div>\s*<div class="editor-body">/);
    expect(bar).not.toBeNull();
    expect(bar![0]).toMatch(/class="editor-cmd-btn" id="cancel-btn"/);
    expect(bar![0]).toMatch(/class="editor-cmd-btn editor-cmd-btn-primary" id="done-btn"/);
  });

  it('cancel-btn + done-btn removed from the .toolbar block', () => {
    const m = ED.match(/<div class="toolbar">[\s\S]*?<\/div>\s*<\/div>/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/id="cancel-btn"/);
    expect(m![0]).not.toMatch(/id="done-btn"/);
  });

  it('syncCmdBarMeta keeps the live meta line in sync', () => {
    expect(ED).toMatch(/private syncCmdBarMeta\(\): void/);
    // Tool select + size slider + keyboard shortcuts all route through it.
    expect(ED).toMatch(/#brush-tool[\s\S]*?this\.syncCmdBarMeta\(\)/);
    expect(ED).toMatch(/sizeInput\.addEventListener\(['"]input['"],[\s\S]*?this\.syncCmdBarMeta\(\)/);
    expect(ED).toMatch(/updateSizeUI\(\)[\s\S]*?this\.syncCmdBarMeta\(\)/);
  });

  it('CSS styles command bar buttons with ≥ 44 px min-height on coarse pointers', () => {
    expect(ED).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.editor-cmd-btn \{ min-height: 44px/,
    );
  });
});
