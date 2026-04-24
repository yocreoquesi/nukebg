import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #76 sub-task A — editor basic left rail invariants.
 */

const ROOT = resolve(__dirname, '..', '..');
const ED = readFileSync(resolve(ROOT, 'src/components/ar-editor.ts'), 'utf8');

describe('ar-editor — left rail (#76-A)', () => {
  it('renders <aside class="editor-rail"> with three groups (tool / shape / size)', () => {
    expect(ED).toMatch(/<aside class="editor-rail"/);
    const m = ED.match(/<aside class="editor-rail"[\s\S]*?<\/aside>/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/id="brush-tool"/);
    expect(m![0]).toMatch(/id="brush-shape"/);
    expect(m![0]).toMatch(/id="brush-size"/);
    // Three .editor-rail-group containers
    const groups = m![0].match(/class="editor-rail-group"/g) ?? [];
    expect(groups.length).toBe(3);
  });

  it('the .toolbar no longer carries tool / shape / size controls (moved to rail)', () => {
    const tb = ED.match(/<div class="toolbar">[\s\S]*?<\/div>\s*<!-- Mini command/);
    expect(tb).not.toBeNull();
    expect(tb![0]).not.toMatch(/id="brush-tool"/);
    expect(tb![0]).not.toMatch(/id="brush-shape"/);
    expect(tb![0]).not.toMatch(/id="brush-size"/);
  });

  it('CSS flattens the rail to a horizontal strip below 900 px and stacks it vertically at/over', () => {
    // Default (mobile): flex-direction wraps via flex-wrap
    expect(ED).toMatch(/\.editor-rail \{[\s\S]*?flex-wrap: wrap/);
    // Desktop: flex-direction: column
    expect(ED).toMatch(
      /@media \(min-width: 900px\) \{[\s\S]*?\.editor-rail \{[\s\S]*?flex-direction: column/,
    );
  });

  it('grid goes 3-col at ≥ 900 px (rail | canvas | sidebar)', () => {
    expect(ED).toMatch(
      /@media \(min-width: 900px\) \{[\s\S]*?\.editor-body \{[\s\S]*?grid-template-columns: 200px minmax\(0, 1fr\) 260px/,
    );
  });

  it('coarse-pointer rule bumps rail selects to ≥ 44 px', () => {
    expect(ED).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.editor-rail-select \{ min-height: 44px/,
    );
  });
});
