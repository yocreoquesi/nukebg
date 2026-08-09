#!/usr/bin/env node
/**
 * Honest `npm audit` gate.
 *
 * Plain `npm audit` had been a required check sitting red for months, which is
 * worse than having no check: it trains everyone to scroll past it, so a
 * genuinely new advisory arrives invisible among the familiar ones.
 *
 * This gate fails on:
 *   - any advisory for a package not in .audit-allowlist.json
 *   - any allowlist entry whose reviewBy date has passed
 *
 * Accepted findings are printed on every run, so they stay visible rather than
 * silently suppressed, and they expire on their own.
 *
 * Exit 0 = clean or fully-justified. Exit 1 = something needs a human.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST = resolve(repoRoot, '.audit-allowlist.json');

function runAudit() {
  try {
    // npm audit exits non-zero when it finds anything; that is expected here,
    // so read stdout from the error path too.
    return JSON.parse(
      // execSync (single command string) rather than execFileSync: on Windows
      // npm is a .cmd shim that Node refuses to spawn directly since the
      // CVE-2024-27980 hardening, and passing args alongside shell:true is
      // deprecated. No interpolation here, so nothing is injectable.
      execSync('npm audit --json', {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const { entries } = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
const allowed = new Map(entries.map((e) => [e.package, e]));
const audit = runAudit();
const found = Object.values(audit.vulnerabilities ?? {}).filter(
  (v) => v.severity && v.severity !== 'info',
);

const unlisted = [];
const accepted = [];
for (const v of found) {
  const entry = allowed.get(v.name);
  if (entry) accepted.push({ v, entry });
  else unlisted.push(v);
}

// An entry that outlives its review date is not an accepted risk any more.
const today = new Date().toISOString().slice(0, 10);
const expired = entries.filter((e) => e.reviewBy < today);

// Entries for advisories that no longer appear: the reason to keep them is gone.
const stale = entries.filter((e) => !found.some((v) => v.name === e.package));

console.log(`npm audit: ${found.length} advisories, ${accepted.length} accepted\n`);

if (accepted.length) {
  console.log('Accepted (documented in .audit-allowlist.json):');
  for (const { v, entry } of accepted) {
    console.log(`  ${v.severity.padEnd(9)} ${v.name.padEnd(26)} review by ${entry.reviewBy}`);
  }
  console.log('');
}

let failed = false;

if (unlisted.length) {
  failed = true;
  console.error('NEW advisories, not accepted anywhere:');
  for (const v of unlisted) {
    console.error(`  ::error::${v.severity} ${v.name} — fix it, or add a justified entry`);
  }
  console.error('');
}

if (expired.length) {
  failed = true;
  console.error('Allowlist entries past their review date:');
  for (const e of expired) {
    console.error(`  ::error::${e.package} was due for review on ${e.reviewBy}`);
  }
  console.error('');
}

if (stale.length) {
  // Not a failure — the advisory is gone, which is good news — but the entry
  // should not linger and quietly pre-approve a future finding.
  console.log('Allowlist entries with no matching advisory any more (safe to delete):');
  for (const e of stale) console.log(`  ${e.package}`);
  console.log('');
}

if (failed) {
  console.error('Audit gate failed.');
  process.exit(1);
}

console.log('Audit gate passed: every finding is accounted for and in date.');
