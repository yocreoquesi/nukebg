#!/usr/bin/env node
/**
 * Refuse to publish nukebg-cli while a direct dependency forces a nested copy
 * of a package the CLI pins for security reasons (#404).
 *
 * npm applies `overrides` only from the install root, and this monorepo's root
 * package.json is never published. So the `sharp: ^0.35.4` pin added in #381
 * fixes this tree — which is all CI and the audit gate ever look at — and
 * nothing a user installs.
 *
 * Concretely, today: nukebg-cli depends on sharp ^0.35.4 and on
 * @huggingface/transformers ^3.8.1, and transformers hard-depends on
 * sharp ^0.34.1. A range 0.35.4 cannot satisfy, so `npm i -g nukebg-cli`
 * resolves the good copy at top level and a nested 0.34.x underneath.
 *
 * This script does not decide whether that is acceptable. It only makes sure
 * the decision is taken deliberately rather than discovered by a user: it runs
 * from `prepublishOnly`, so CI stays green and `npm publish` stops with an
 * explanation.
 *
 *   node scripts/check-publish-deps.mjs
 *
 * Exit 0 = no direct dependency forces a conflicting nested copy.
 * Exit 1 = one does; the message names the pair and points at #404.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));

/**
 * Does `version` satisfy `range`?
 *
 * Deliberately handles only the shapes this repo uses — `^x.y.z`, `~x.y.z`,
 * and exact — rather than pulling in a semver dependency for a script whose
 * whole job is to be run once at publish time. Anything it does not recognise
 * is reported as unknown rather than silently passing, because a check that
 * fails open is the thing this file exists to prevent.
 */
export function satisfies(version, range) {
  const parse = (v) => v.split('.').map(Number);
  const [vMaj, vMin, vPat] = parse(version);
  const m = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) return 'unknown';
  const [, op, maj, min, pat] = m;
  const [rMaj, rMin, rPat] = [Number(maj), Number(min), Number(pat)];

  const atLeast =
    vMaj > rMaj ||
    (vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPat >= rPat)));
  if (!atLeast) return false;

  // 0.x is special in semver: ^0.34.1 allows 0.34.x but not 0.35.0.
  if (op === '^') return rMaj === 0 ? vMaj === 0 && vMin === rMin : vMaj === rMaj;
  if (op === '~') return vMaj === rMaj && vMin === rMin;
  return vMaj === rMaj && vMin === rMin && vPat === rPat;
}

/** The version the root override pins a package to, if it pins one. */
function overriddenTo(name) {
  const range = (read('package.json').overrides ?? {})[name];
  return range ? range.replace(/^[\^~]/, '') : null;
}

export function findConflicts() {
  const cli = read('packages/nukebg-cli/package.json');
  const direct = { ...(cli.dependencies ?? {}) };
  const conflicts = [];

  for (const depName of Object.keys(direct)) {
    let depManifest;
    try {
      depManifest = read(`node_modules/${depName}/package.json`);
    } catch {
      continue; // not installed here; nothing to inspect
    }
    for (const [nested, nestedRange] of Object.entries(depManifest.dependencies ?? {})) {
      if (!(nested in direct)) continue;
      const pinned = overriddenTo(nested) ?? direct[nested].replace(/^[\^~]/, '');
      const ok = satisfies(pinned, nestedRange);
      if (ok === false || ok === 'unknown') {
        conflicts.push({ via: depName, nested, nestedRange, pinned, verdict: ok });
      }
    }
  }
  return conflicts;
}

// Running as a script rather than imported by the tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const conflicts = findConflicts();
  if (conflicts.length === 0) {
    console.log('publish check passed: no direct dependency forces a conflicting nested copy.');
    process.exit(0);
  }
  console.error('Refusing to publish nukebg-cli.\n');
  for (const c of conflicts) {
    console.error(
      `  ${c.nested}: the CLI resolves ${c.pinned}, but ${c.via} requires ${c.nestedRange}` +
        `${c.verdict === 'unknown' ? ' (range not understood by this check)' : ''}`,
    );
  }
  console.error(
    '\nnpm applies `overrides` only from the install root, and this workspace root is\n' +
      'never published — so an installed CLI gets BOTH copies. CI cannot see this,\n' +
      'because in this tree the override collapses them into one.\n\n' +
      'This is not a claim that the nested copy is exploitable; see #404 for the\n' +
      'reachability analysis. It is a claim that publishing should be a decision,\n' +
      'not an accident. Resolve #404, then publish.',
  );
  process.exit(1);
}
