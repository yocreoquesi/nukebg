import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Every dated changelog section is tagged, and every compare link resolves.
 *
 * WHAT WENT WRONG
 *
 * Releases 2.8.0, 2.11.0, 2.11.1, 2.11.2 and 2.12.0 were written up here and
 * shipped to production without ever being tagged. The changelog kept moving
 * and the tags stopped in April, so 206 commits reached users with no tag
 * marking any of it, and the two compare links that did exist pointed at
 * tags that did not. Sixteen sections carried three links between them.
 *
 * Nothing failed, because nothing was checking. A dated section is a claim
 * that something was released; this asserts the claim is true.
 *
 * THIS TEST NEEDS TAGS, WHICH CI DOES NOT FETCH BY DEFAULT
 *
 * `actions/checkout` makes a shallow clone without tags, so `git tag` comes
 * back empty and every assertion below would fail for want of data rather
 * than for a real defect. The workflow therefore passes `fetch-tags` and
 * `fetch-depth: 0`. If this suite starts failing everywhere at once, check
 * that before checking the changelog — and rather than guess, the first
 * assertion fails loudly when no tags are visible at all.
 *
 * The 0.0.0 / 1970-01-01 section is an empty template stub, not a release.
 * It is excluded by version rather than by position, so it stays excluded
 * if it ever moves.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CHANGELOG = readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8');

/** A stub, not a release: empty sections, epoch date. */
const NOT_A_RELEASE = new Set(['0.0.0']);

const sections = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
  .map((m) => m[1])
  .filter((v) => !NOT_A_RELEASE.has(v));

const linkRefs = new Map(
  [...CHANGELOG.matchAll(/^\[(\d+\.\d+\.\d+)\]:\s*(\S+)/gm)].map((m) => [m[1], m[2]]),
);

function gitTags(): Set<string> {
  return new Set(
    execFileSync('git', ['tag'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean),
  );
}

describe('changelog integrity', () => {
  const tags = gitTags();

  it('git tags are visible at all', () => {
    // Guards every assertion below: a shallow clone without tags would make
    // them fail for the wrong reason, or — worse for the section/link
    // checks — pass while proving nothing.
    expect(
      tags.size,
      'no git tags visible — CI needs fetch-tags: true and fetch-depth: 0 on checkout',
    ).toBeGreaterThan(5);
    expect(sections.length, 'no dated sections parsed from CHANGELOG.md').toBeGreaterThan(5);
  });

  it('every dated section has a git tag', () => {
    const untagged = sections.filter((v) => !tags.has(`v${v}`));
    expect(
      untagged,
      'dated in the changelog but never tagged — cut the tag, or the section is premature',
    ).toEqual([]);
  });

  it('every dated section has a compare link', () => {
    const unlinked = sections.filter((v) => !linkRefs.has(v));
    expect(unlinked, 'sections with no link reference at the bottom of the file').toEqual([]);
  });

  it('every link reference points at a tag that exists', () => {
    const dangling: string[] = [];
    for (const [version, url] of linkRefs) {
      for (const tag of url.match(/v\d+\.\d+\.\d+/g) ?? []) {
        if (!tags.has(tag)) dangling.push(`[${version}] -> ${tag}`);
      }
    }
    expect(dangling, 'compare links pointing at tags that do not exist').toEqual([]);
  });

  it('every link reference belongs to a section', () => {
    const orphans = [...linkRefs.keys()].filter((v) => !sections.includes(v));
    expect(orphans, 'link references for versions with no section').toEqual([]);
  });

  it('Unreleased compares from the newest release', () => {
    const unreleased = CHANGELOG.match(/^\[Unreleased\]:\s*(\S+)/m)?.[1];
    expect(unreleased, 'no [Unreleased] link reference').toBeTruthy();
    expect(
      unreleased,
      `[Unreleased] should compare from v${sections[0]}, the newest section`,
    ).toContain(`v${sections[0]}...`);
  });
});
