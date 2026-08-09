import { describe, it, expect } from 'vitest';
import { resolveVersion } from '../../src/util/version.js';

// ---------------------------------------------------------------------------
// Resolves nukebg-cli's own package.json version (tasks.md 16.5). Real fs —
// walks up from this module's location to find nukebg-cli's package.json,
// so the test exercises the real behavior rather than a mocked seam.
// ---------------------------------------------------------------------------

describe('resolveVersion', () => {
  it('returns a version string matching semver', () => {
    const version = resolveVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
