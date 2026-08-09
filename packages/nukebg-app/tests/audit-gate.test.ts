import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper with no type declarations, deliberately
// kept dependency-free so the CI gate can run it with bare node.
import { evaluate } from '../../../scripts/audit-gate-core.mjs';

// The audit gate decides whether CI passes, and its whole job is to fail when
// nobody is watching. Both of the holes below were real: they existed in the
// first version and were found by probing the running script by hand, not by
// reading it. Hand-probes prove a gate works today; these prove it still works
// after the next edit.

const TODAY = '2026-08-10';

function finding(name: string, severity: string, ids: string[]) {
  return {
    name,
    severity,
    via: ids.map((id) => ({ url: `https://github.com/advisories/${id}` })),
  };
}

/** A finding inherited from a dependency carries strings, not advisory objects. */
function transitiveFinding(name: string, severity: string, viaPackage: string) {
  return { name, severity, via: [viaPackage] };
}

const auditWith = (...vulns: object[]) => ({
  vulnerabilities: Object.fromEntries(vulns.map((v) => [(v as { name: string }).name, v])),
});

const entry = (over: Record<string, unknown> = {}) => ({
  package: 'tar',
  advisories: ['GHSA-aaa'],
  severity: 'critical',
  reachability: 'build-time only',
  'why-accepted': 'no fix',
  reviewBy: '2026-09-15',
  ...over,
});

describe('audit gate', () => {
  it('passes when every finding is declared and in date', () => {
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'])), [entry()], TODAY);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  it('fails on an advisory in a package that is not listed at all', () => {
    const r = evaluate(auditWith(finding('lodash', 'high', ['GHSA-zzz'])), [entry()], TODAY);
    expect(r.ok).toBe(false);
    expect(r.unlisted.map((v: { name: string }) => v.name)).toEqual(['lodash']);
  });

  // Hole 1. The first version keyed on package name alone, so the advisories
  // list was decorative: a brand-new CRITICAL in an already-listed package
  // printed as "accepted" and the gate passed. That is the exact arrival this
  // gate exists to catch.
  it('fails on a NEW advisory inside an already-listed package', () => {
    const r = evaluate(
      auditWith(finding('tar', 'critical', ['GHSA-aaa', 'GHSA-brand-new'])),
      [entry()],
      TODAY,
    );
    expect(r.ok).toBe(false);
    expect(r.undeclared[0].ids).toEqual(['GHSA-brand-new']);
  });

  it('fails on an entry past its review date', () => {
    const r = evaluate(
      auditWith(finding('tar', 'critical', ['GHSA-aaa'])),
      [entry({ reviewBy: '2026-01-01' })],
      TODAY,
    );
    expect(r.ok).toBe(false);
    expect(r.expired).toHaveLength(1);
  });

  // Hole 2. `undefined < '2026-08-10'` is false, so an entry with no reviewBy
  // never expired — a permanent silent suppression.
  it('fails on an entry with no reviewBy instead of never expiring it', () => {
    const e = entry();
    delete (e as Record<string, unknown>).reviewBy;
    const r = evaluate(auditWith(finding('tar', 'critical', ['GHSA-aaa'])), [e], TODAY);
    expect(r.ok).toBe(false);
    expect(r.malformed.join(' ')).toMatch(/reviewBy must be YYYY-MM-DD/);
  });

  it('fails on a malformed review date rather than comparing it lexically', () => {
    const r = evaluate(
      auditWith(finding('tar', 'critical', ['GHSA-aaa'])),
      [entry({ reviewBy: 'soon' })],
      TODAY,
    );
    expect(r.ok).toBe(false);
    expect(r.malformed.join(' ')).toMatch(/reviewBy/);
  });

  it('fails when advisories is not an array', () => {
    const r = evaluate(
      auditWith(finding('tar', 'critical', ['GHSA-aaa'])),
      [entry({ advisories: 'GHSA-aaa' })],
      TODAY,
    );
    expect(r.ok).toBe(false);
    expect(r.malformed.join(' ')).toMatch(/advisories must be an array/);
  });

  it('accepts a purely transitive finding only when the entry declares no IDs', () => {
    const t = transitiveFinding('@huggingface/transformers', 'high', 'sharp');

    const withEmpty = evaluate(
      auditWith(t),
      [entry({ package: '@huggingface/transformers', advisories: [] })],
      TODAY,
    );
    expect(withEmpty.ok).toBe(true);

    // Declaring specific IDs for something that reports none is a mismatch, not
    // a free pass.
    const withIds = evaluate(
      auditWith(t),
      [entry({ package: '@huggingface/transformers', advisories: ['GHSA-aaa'] })],
      TODAY,
    );
    expect(withIds.ok).toBe(false);
  });

  it('ignores info-severity noise', () => {
    const r = evaluate(auditWith(finding('whatever', 'info', ['GHSA-i'])), [], TODAY);
    expect(r.ok).toBe(true);
  });

  it('reports an entry whose advisory has disappeared, without failing', () => {
    const r = evaluate(auditWith(), [entry()], TODAY);
    expect(r.ok).toBe(true);
    expect(r.stale.map((e: { package: string }) => e.package)).toEqual(['tar']);
  });
});
