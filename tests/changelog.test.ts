import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const CHANGELOG = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');

describe('CHANGELOG.md', () => {
  it('starts with a top-level heading', () => {
    expect(CHANGELOG.startsWith('# Changelog')).toBe(true);
  });

  it('tracks an active [Unreleased] section', () => {
    expect(CHANGELOG).toMatch(/^## \[Unreleased\]/m);
  });

  it('references Keep a Changelog + SemVer conventions so contributors know the format', () => {
    expect(CHANGELOG).toMatch(/Keep a Changelog/);
    expect(CHANGELOG).toMatch(/SemVer/);
  });

  it('keeps the unified category vocabulary (Added/Changed/Security/Pipeline/Accessibility/etc.)', () => {
    for (const h of [
      '### Added',
      '### Changed',
      '### Security',
      '### Pipeline',
      '### Accessibility',
      '### Infrastructure',
      '### Tooling / CI',
      '### Documentation',
    ]) {
      expect(CHANGELOG).toContain(h);
    }
  });

  it('surfaces the latest merged PRs so the Unreleased entry stays current', () => {
    // Sanity check that the most recent batch of work is represented.
    // Bump these as the changelog grows; they are the canary for stale
    // digests.
    for (const pr of ['#101', '#106', '#113', '#114', '#115']) {
      expect(CHANGELOG).toContain(pr);
    }
  });

  it('ships a release-checklist template and compare link at the bottom', () => {
    expect(CHANGELOG).toMatch(/## Release checklist template/);
    expect(CHANGELOG).toMatch(/\[Unreleased\]: https:\/\/github\.com\/yocreoquesi\/nukebg\/compare\//);
  });
});
