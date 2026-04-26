import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Version must be in lockstep across every surface that exposes it
 * to a user (footer, JSON-LD, browser console, PNG metadata).
 *
 * package.json is the single source of truth. If any of these checks
 * fails after a release bump, the bump was incomplete.
 */
const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const pkg = JSON.parse(read('package.json')) as { version: string };
const VERSION = pkg.version;

describe('version consistency', () => {
  it('package.json declares a semver version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('index.html footer span shows the current version', () => {
    const html = read('index.html');
    const re = new RegExp(
      `<span>\\s*NukeBG\\s*<span[^>]*>\\s*v${VERSION.replace(/\./g, '\\.')}\\s*</span>`,
    );
    expect(html).toMatch(re);
  });

  it('index.html JSON-LD softwareVersion matches package.json', () => {
    const html = read('index.html');
    expect(html).toMatch(
      new RegExp(`"softwareVersion"\\s*:\\s*"${VERSION.replace(/\./g, '\\.')}"`),
    );
  });

  it('src/main.ts console logo shows the current version', () => {
    const main = read('src/main.ts');
    expect(main).toContain(`v${VERSION}`);
  });

  it('src/utils/image-io.ts PNG metadata Software tag matches package.json', () => {
    const io = read('src/utils/image-io.ts');
    expect(io).toContain(`'NukeBG v${VERSION}'`);
  });

  it('no other version (vX.Y.Z) appears in tracked surfaces', () => {
    const surfaces = ['index.html', 'src/main.ts', 'src/utils/image-io.ts'];
    const stale: string[] = [];
    for (const path of surfaces) {
      const txt = read(path);
      const matches = txt.match(/v\d+\.\d+\.\d+/g) ?? [];
      for (const m of matches) {
        if (m !== `v${VERSION}`) stale.push(`${path}: found ${m} (expected v${VERSION})`);
      }
    }
    expect(stale).toEqual([]);
  });
});
