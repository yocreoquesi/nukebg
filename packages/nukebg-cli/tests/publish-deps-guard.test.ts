import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — plain .mjs script, no types, deliberately dependency-free
import { satisfies, findConflicts } from '../../../scripts/check-publish-deps.mjs';

/**
 * The publish guard for #404.
 *
 * npm applies `overrides` only from the install root, and this monorepo's root
 * package.json is never published — so the `sharp: ^0.35.4` pin from #381
 * fixes this tree and nothing a user installs. CI cannot see the difference,
 * because here the override collapses the two copies into one.
 *
 * `scripts/check-publish-deps.mjs` runs from `prepublishOnly`, so it does not
 * gate CI; it stops `npm publish` with an explanation instead. These tests
 * exist because a guard that fails open is worse than none, and the semver
 * comparison is the part that would fail open if it were wrong.
 */

const REPO = resolve(__dirname, '..', '..', '..');

describe('satisfies — the caret semantics the guard rests on', () => {
  it.each([
    // 0.x is the case that matters here: ^0.34.1 must NOT accept 0.35.x,
    // which is exactly why transformers and the CLI cannot share one sharp.
    ['0.34.5', '^0.34.1', true],
    ['0.35.4', '^0.34.1', false],
    ['0.34.0', '^0.34.1', false],
    // Normal caret above 0.x.
    ['1.5.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    // Tilde and exact.
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
  ])('%s vs %s -> %s', (version, range, expected) => {
    expect(satisfies(version as string, range as string)).toBe(expected);
  });

  it.each(['>=1.0.0 <2', 'workspace:*', 'npm:other@1.0.0', 'latest'])(
    'reports %s as unknown rather than passing it',
    (range) => {
      // Failing open is the one outcome this script must never have.
      expect(satisfies('1.0.0', range)).toBe('unknown');
    },
  );
});

describe('findConflicts — against the real tree', () => {
  it('still reports the known sharp gap, so the guard is not silently satisfied', () => {
    const conflicts = findConflicts() as Array<Record<string, string>>;
    const sharp = conflicts.find((c) => c.nested === 'sharp');

    expect(
      sharp,
      'no sharp conflict found — either #404 was resolved (update this test) ' +
        'or the guard stopped detecting it (fix the guard)',
    ).toBeDefined();
    expect(sharp!.via).toBe('@huggingface/transformers');
  });

  it('the CLI is still publishable, which is what makes the guard load-bearing', () => {
    // If nukebg-cli were marked private the guard would be belt-and-braces.
    // It is not, so prepublishOnly is the only thing standing between this
    // gap and a published package.
    const cli = JSON.parse(readFileSync(resolve(REPO, 'packages/nukebg-cli/package.json'), 'utf8'));
    expect(cli.private ?? false).toBe(false);
    expect(cli.scripts.prepublishOnly).toContain('check-publish-deps');
  });
});
