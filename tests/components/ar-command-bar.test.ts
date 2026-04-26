import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Processing-state command bar (#71) invariants.
 *
 * ar-app is too heavy to mount in happy-dom. These source-level tests
 * pin the contract so nothing silently regresses:
 *   - Command bar exists in the workspace, above ar-viewer, above ar-progress.
 *   - New Image + Cancel buttons wire to the expected handlers.
 *   - Cancel button was removed from ar-progress.
 *   - Viewer chips use solid black + status dot + accent border on result.
 *   - Reactor segmented control renders inside the workspace.
 *   - i18n parity for the new cmdbar.* keys.
 */

const ROOT = resolve(__dirname, '..', '..');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const VIEW = readFileSync(resolve(ROOT, 'src/components/ar-viewer.ts'), 'utf8');
const PROG = readFileSync(resolve(ROOT, 'src/components/ar-progress.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('Command bar — ar-app.ts invariants', () => {
  it('renders <div class="command-bar"> inside the single-file workspace', () => {
    expect(APP).toMatch(/<div class="command-bar"[^>]*id="command-bar"/);
    // Situated inside #single-file-workspace and BEFORE ar-viewer.
    const ws = APP.match(
      /<div class="single-file-workspace"[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/,
    );
    expect(ws).not.toBeNull();
    const idx = ws![0].indexOf('<div class="command-bar"');
    const viewerIdx = ws![0].indexOf('<ar-viewer>');
    expect(idx).toBeGreaterThan(-1);
    expect(viewerIdx).toBeGreaterThan(idx);
  });

  it('exposes #cmd-filename, #cmd-meta, #cmd-state, #cmd-cancel', () => {
    // #151: 'new image' button removed — duplicated by 'procesar otra'
    // in the result area. Only Cancel survives in the cmd-bar right side.
    for (const id of ['cmd-filename', 'cmd-meta', 'cmd-state', 'cmd-cancel']) {
      expect(APP, id).toMatch(new RegExp(`id="${id}"`));
    }
    expect(APP).not.toMatch(/id="cmd-new-image"/);
  });

  it('Cancel click dispatches ar:cancel-processing from the shadow root', () => {
    expect(APP).toMatch(/const bubbleCancel = \(\): void =>/);
    expect(APP).toMatch(/new CustomEvent\(['"]ar:cancel-processing['"]/);
    expect(APP).toMatch(/cmdCancel\?\.addEventListener\(['"]click['"], bubbleCancel/);
  });

  it('New Image button removed in #151 — duplicated by procesar otra in result area', () => {
    expect(APP).not.toMatch(/cmdNewImage/);
    expect(APP).not.toMatch(/cmdbar\.newImage/);
  });

  it('updateCommandBar + updateCommandBarState methods exist with the documented signature', () => {
    expect(APP).toMatch(
      /private updateCommandBar\(payload:[\s\S]*?filename:[\s\S]*?sizeBytes:[\s\S]*?state:[\s\S]*?\}\): void/,
    );
    expect(APP).toMatch(
      /private updateCommandBarState\(state: ['"]running['"] \| ['"]ready['"] \| ['"]failed['"]\): void/,
    );
  });

  it('updateTexts re-translates the surviving cmdbar labels on locale change', () => {
    expect(APP).toMatch(/cmdCancel.*t\(['"]cmdbar\.cancel['"]\)/);
  });
});

describe('ar-progress — Cancel button removed (#71)', () => {
  it('no longer renders <button id="cancel-btn">', () => {
    expect(PROG).not.toMatch(/<button[\s\S]*?id="cancel-btn"/);
  });
  it('setRunning kept as no-op so host call sites still compile', () => {
    expect(PROG).toMatch(/setRunning\(_running: boolean\): void \{/);
  });
});

describe('Viewer chips — #71', () => {
  it('chips use solid #000 background (not rgba(0,0,0,0.85))', () => {
    expect(VIEW).not.toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.85\)/);
    expect(VIEW).toMatch(/\.label\s*\{[\s\S]*?background:\s*#000/);
  });

  it('chip has a leading status dot (::before content: "●")', () => {
    expect(VIEW).toMatch(/\.label::before\s*\{[\s\S]*?content:\s*['"]●['"]/);
  });

  it('result chip uses accent-primary border + glow', () => {
    expect(VIEW).toMatch(
      /\.label-result\s*\{[\s\S]*?border-color:\s*var\(--color-accent-primary[\s\S]*?box-shadow:\s*0 0 8px rgba\(var\(--color-accent-rgb/,
    );
  });

  it('canvas-layer max-height respects viewport height', () => {
    expect(VIEW).toMatch(/max-height:\s*min\(600px,\s*65vh\)/);
  });
});

describe('i18n parity — cmdbar.*', () => {
  const keys = ['cmdbar.cancel', 'cmdbar.running', 'cmdbar.ready', 'cmdbar.failed'];
  for (const key of keys) {
    it(`'${key}' declared in all six locales`, () => {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length).toBe(6);
    });
  }
});
