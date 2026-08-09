#!/usr/bin/env node
/**
 * Honest `npm audit` gate.
 *
 * Plain `npm audit` had been a required check sitting red for months, which is
 * worse than having no check: it trains everyone to scroll past it, so a
 * genuinely new advisory arrives invisible among the familiar ones.
 *
 * This gate fails on:
 *   - an advisory for a package not in .audit-allowlist.json
 *   - a NEW advisory in a package that is listed for other advisories
 *   - an entry accepted because no fix existed, once npm reports one
 *   - an entry that is malformed (bad acceptedBecause, no advisories array)
 *
 * There are no review dates: a calendar expiry would add a scheduled CI
 * failure and busywork to a low-maintenance repo, and none of the accepted
 * packages reach the shipped static site. See .audit-allowlist.json.
 *
 * Accepted findings are printed on every run, so they stay visible rather than
 * silently suppressed.
 *
 * The decision logic lives in audit-gate-core.mjs and is unit-tested; this file
 * is only the shell that runs npm and prints.
 *
 * Exit 0 = clean or fully-justified. Exit 1 = something needs a human.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluate } from './audit-gate-core.mjs';

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
    // Anything else — npm missing, registry unreachable, malformed JSON — is a
    // failure, not a pass. This gate never fails open.
    throw err;
  }
}

const { entries } = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
const r = evaluate(runAudit(), entries);

const total = r.accepted.length + r.unlisted.length + r.undeclared.length;
console.log(`npm audit: ${total} advisories, ${r.accepted.length} accepted\n`);

if (r.accepted.length) {
  console.log('Accepted (documented in .audit-allowlist.json):');
  for (const { finding, entry } of r.accepted) {
    console.log(
      `  ${finding.severity.padEnd(9)} ${finding.name.padEnd(26)} ${entry.acceptedBecause}`,
    );
  }
  console.log('');
}

if (r.malformed.length) {
  console.error('Allowlist entries that cannot be trusted:');
  for (const m of r.malformed) console.error(`  ::error::${m}`);
  console.error('');
}

if (r.unlisted.length) {
  console.error('NEW advisories, not accepted anywhere:');
  for (const v of r.unlisted) {
    console.error(`  ::error::${v.severity} ${v.name} — fix it, or add a justified entry`);
  }
  console.error('');
}

if (r.undeclared.length) {
  console.error('NEW advisories in packages allowlisted for OTHER advisories:');
  for (const u of r.undeclared) {
    console.error(
      `  ::error::${u.severity ?? ''} ${u.name} — ${u.ids.join(', ')} not in that entry's advisories list`,
    );
  }
  console.error('');
}

if (r.fixNowAvailable.length) {
  console.error('Accepted only because no fix existed — a fix now exists:');
  for (const f of r.fixNowAvailable) {
    console.error(
      `  ::error::${f.severity} ${f.name} — upgrade it, or change acceptedBecause to ` +
        `fix-exists-but-not-taken and say why`,
    );
  }
  console.error('');
}

if (r.stale.length) {
  // Not a failure — the advisory is gone, which is good news — but the entry
  // should not linger and quietly pre-approve a future finding.
  console.log('Allowlist entries with no matching advisory any more (safe to delete):');
  for (const e of r.stale) console.log(`  ${e.package}`);
  console.log('');
}

if (!r.ok) {
  console.error('Audit gate failed.');
  process.exit(1);
}

console.log('Audit gate passed: every finding is accounted for.');
