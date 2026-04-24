import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #77 — Advanced editor two-row toolbar layout.
 */

const ROOT = resolve(__dirname, '..', '..');
const ED = readFileSync(resolve(ROOT, 'src/components/ar-editor-advanced.ts'), 'utf8');

describe('ar-editor-advanced — toolbar split into two rows (#77)', () => {
  it('toolbar has a primary row and a contextual row', () => {
    expect(ED).toMatch(/class="toolbar-row toolbar-row-primary"/);
    expect(ED).toMatch(/class="toolbar-row toolbar-row-contextual"/);
  });

  it('primary row carries tools + zoom; contextual row carries size/lasso/preview', () => {
    const primary = ED.match(/class="toolbar-row toolbar-row-primary"[\s\S]*?<\/div>\s*<\/div>/);
    expect(primary).not.toBeNull();
    expect(primary![0]).toMatch(/class="tool-group"/);
    expect(primary![0]).toMatch(/class="zoom-group"/);

    const ctx = ED.match(/class="toolbar-row toolbar-row-contextual"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(ctx).not.toBeNull();
    expect(ctx![0]).toMatch(/id="size-row"/);
    expect(ctx![0]).toMatch(/id="lasso-actions"/);
    expect(ctx![0]).toMatch(/id="preview-actions"/);
  });

  it('CSS stacks the rows vertically with a dashed divider on the contextual row', () => {
    expect(ED).toMatch(/\.toolbar \{[\s\S]*?flex-direction: column/);
    expect(ED).toMatch(/\.toolbar-row-contextual \{[\s\S]*?border-top: 1px dashed/);
  });

  it('contextual row hides when none of its children carry .visible', () => {
    expect(ED).toMatch(/\.toolbar-row-contextual:not\(:has\(> \.visible\)\) \{[\s\S]*?display: none/);
  });
});
