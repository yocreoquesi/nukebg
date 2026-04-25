import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Download CTA (#72) — source invariants.
 * Heavy happy-dom run would require canvas encoding; these source-level
 * tests pin the key contracts.
 */

const ROOT = resolve(__dirname, '..', '..');
const DL = readFileSync(resolve(ROOT, 'src/components/ar-download.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('Download CTA — ar-download.ts invariants', () => {
  it('renders two <a> anchors (primary PNG + secondary WebP) in a .dl-ctas group', () => {
    expect(DL).toMatch(/<div class="dl-ctas"[^>]*role="group"/);
    expect(DL).toMatch(/<a class="dl-cta dl-cta-primary" id="dl-png"/);
    expect(DL).toMatch(/<a class="dl-cta dl-cta-secondary" id="dl-webp"/);
    // Each anchor has cmd + meta spans
    for (const id of ['dl-png-cmd', 'dl-png-meta', 'dl-webp-cmd', 'dl-webp-meta']) {
      expect(DL, id).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('no longer renders the legacy format-toggle / #download-btn', () => {
    expect(DL).not.toMatch(/id="format-png"/);
    expect(DL).not.toMatch(/id="format-webp"[^-]/);
    expect(DL).not.toMatch(/id="download-btn"/);
  });

  it('eagerly encodes PNG and lazily encodes WebP via prepareWebp()', () => {
    expect(DL).toMatch(/private async prepareWebp\(imageData: ImageData\): Promise<void>/);
    expect(DL).toMatch(/void this\.prepareWebp\(imageData\);/);
    // PNG blob URL is set before prepareWebp fires.
    expect(DL).toMatch(/this\.pngBlobUrl = URL\.createObjectURL\(blob\);[\s\S]*?this\.updateCtaAnchors\(['"]png-only['"]\)/);
  });

  it('updateCtaAnchors fills href + download filename + meta line for each anchor', () => {
    expect(DL).toMatch(/png\.setAttribute\(['"]href['"], this\.pngBlobUrl\)/);
    expect(DL).toMatch(/png\.setAttribute\(['"]download['"], this\.pngFilename\)/);
    expect(DL).toMatch(/webp\.setAttribute\(['"]href['"], this\.webpBlobUrl\)/);
    expect(DL).toMatch(/webp\.setAttribute\(['"]download['"], this\.webpFilename\)/);
  });

  it('formatMeta renders only the file size — no resolution, no alpha flag', () => {
    expect(DL).toMatch(/formatMeta\(bytes: number\): string/);
    expect(DL).toMatch(/return `# \$\{this\.formatBytes\(bytes\)\}`/);
    expect(DL).not.toMatch(/hasAlpha/);
    expect(DL).not.toMatch(/detectAlpha/);
  });

  it('formatBytes renders KB below 1 MiB and MB above', () => {
    expect(DL).toMatch(/formatBytes\(bytes: number\): string/);
    expect(DL).toMatch(/return `\$\{bytes\} B`/);
    expect(DL).toMatch(/return `\$\{kb < 10 \? kb\.toFixed\(1\) : Math\.round\(kb\)\} KB`/);
  });

  it('reset() clears both blob URLs and hides both anchors', () => {
    expect(DL).toMatch(/reset\(\): void \{[\s\S]*?pngBlobUrl[\s\S]*?webpBlobUrl[\s\S]*?png\.hidden = true[\s\S]*?webp\.hidden = true/);
  });
});

describe('i18n parity — download.cta.*', () => {
  const keys = ['download.cta.png', 'download.cta.webp', 'download.groupLabel'];
  for (const key of keys) {
    it(`'${key}' declared in all six locales`, () => {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length).toBe(6);
    });
  }
});
