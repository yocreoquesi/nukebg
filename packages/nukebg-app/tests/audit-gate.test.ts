import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper with no type declarations, deliberately
// kept dependency-free so the CI gate can run it with bare node.
import { evaluate } from '../../../scripts/audit-gate-core.mjs';

// The audit gate decides whether CI passes, and its whole job is to fail when
// nobody is watching. Two of the cases below were real holes in the first
// version, found by probing the running script by hand rather than by reading
// it. Hand-probes prove a gate works today; these prove it still works after
// the next edit.
//
// There are no review dates in this model. Expiry is event-driven: an entry
// accepted because upstream had no fix re-fails the moment a fix appears.

function finding(
  name: string,
  severity: string,
  ids: string[],
  fixAvailable: unknown = false,
) {
  return {
    name,
    severity,
    fixAvailable,
    via: ids.map((id) => ({ url: `https://github.com/advisories/${id}` })),
  };
}

/** A finding inherited from a dependency carries strings, not advisory objects. */
function transitiveFinding(name: string, severity: string, viaPackage: string, fixAvailable = false) {
  return { name, severity, fixAvailable, via: [viaPackage] };
}

const auditWith = (...vulns: object[]) => ({
  vulnerabilities: Object.fromEntries(vulns.map((v) => [(v as { name: string }).name, v])),
});

const entry = (over: Record<string, unknown> = {}) => ({
  package: 'tar',
  advisories: ['GHSA-aaa'],
  severity: 'critical',
  reachability: 'build-time only',
  'why-accepted': 'override does not apply',
  acceptedBecause: 'fix-exists-but-not-taken',
  ...over,
});

describe('audit gate', () => {
  it('passes when every finding is declared', () => {
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'], true)), [entry()]);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  it('fails on an advisory in a package that is not listed at all', () => {
    const r = evaluate(auditWith(finding('lodash', 'high', ['GHSA-zzz'])), [entry()]);
    expect(r.ok).toBe(false);
    expect(r.unlisted.map((v: { name: string }) => v.name)).toEqual(['lodash']);
  });

  // Hole 1 in the first version: matching keyed on package name alone, so the
  // advisories list was decorative and a brand-new CRITICAL in an
  // already-listed package printed as "accepted".
  it('fails on a NEW advisory inside an already-listed package', () => {
    const r = evaluate(
      auditWith(finding('tar', 'critical', ['GHSA-aaa', 'GHSA-brand-new'], true)),
      [entry()],
    );
    expect(r.ok).toBe(false);
    expect(r.undeclared[0].ids).toEqual(['GHSA-brand-new']);
  });

  // The replacement for calendar expiry: the justification "there is nothing
  // to upgrade to" stops being true the moment upstream ships something.
  it('fails when a fix appears for something accepted only because none existed', () => {
    const e = entry({ package: 'sharp', advisories: ['GHSA-s'], acceptedBecause: 'no-fix-available' });

    const noFixYet = evaluate(auditWith(finding('sharp', 'high', ['GHSA-s'], false)), [e]);
    expect(noFixYet.ok).toBe(true);

    const fixLanded = evaluate(
      auditWith(finding('sharp', 'high', ['GHSA-s'], { name: 'sharp', version: '0.36.0' })),
      [e],
    );
    expect(fixLanded.ok).toBe(false);
    expect(fixLanded.fixNowAvailable[0].name).toBe('sharp');
  });

  it('does not fire that rule for entries that knowingly skipped a fix', () => {
    // tar has fixAvailable: true today and is accepted anyway, with a reason.
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'], true)), [entry()]);
    expect(r.ok).toBe(true);
    expect(r.fixNowAvailable).toHaveLength(0);
  });

  // Hole 2 in the first version: the old `reviewBy` field compared
  // `undefined < today`, which is false, so a missing value never expired.
  // The replacement field is validated instead of silently tolerated.
  it('fails on an unknown or missing acceptedBecause', () => {
    const missing = entry();
    delete (missing as Record<string, unknown>).acceptedBecause;
    expect(evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'])), [missing]).ok).toBe(false);

    const bogus = entry({ acceptedBecause: 'because-i-said-so' });
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'])), [bogus]);
    expect(r.ok).toBe(false);
    expect(r.malformed.join(' ')).toMatch(/acceptedBecause/);
  });

  it('fails when advisories is not an array', () => {
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'])), [
      entry({ advisories: 'GHSA-aaa' }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.malformed.join(' ')).toMatch(/advisories must be an array/);
  });

  it('accepts a purely transitive finding only when the entry declares no IDs', () => {
    const t = transitiveFinding('@huggingface/transformers', 'high', 'sharp');

    const withEmpty = evaluate(auditWith(t), [
      entry({ package: '@huggingface/transformers', advisories: [], acceptedBecause: 'no-fix-available' }),
    ]);
    expect(withEmpty.ok).toBe(true);

    // Declaring specific IDs for something that reports none is a mismatch,
    // not a free pass.
    const withIds = evaluate(auditWith(t), [
      entry({ package: '@huggingface/transformers', advisories: ['GHSA-aaa'] }),
    ]);
    expect(withIds.ok).toBe(false);
  });

  it('ignores info-severity noise', () => {
    const r = evaluate(auditWith(finding('whatever', 'info', ['GHSA-i'])), []);
    expect(r.ok).toBe(true);
  });

  it('reports an entry whose advisory has disappeared, without failing', () => {
    const r = evaluate(auditWith(), [entry()]);
    expect(r.ok).toBe(true);
    expect(r.stale.map((e: { package: string }) => e.package)).toEqual(['tar']);
  });
});
