/**
 * The audit gate's decision logic, as a pure function.
 *
 * Split out of audit-gate.mjs so it can be unit-tested against fixtures. The
 * first version had two holes that only surfaced from probing the running
 * script by hand — matching on package name alone, so a new advisory in an
 * already-listed package sailed through as "accepted", and an entry with no
 * expiry comparing `undefined < today` and never expiring.
 *
 * Hand-probes prove a gate works today. Tests prove it still works after the
 * next edit, which is the part that matters for something whose whole job is
 * to fail when nobody is watching.
 *
 * ---------------------------------------------------------------------------
 * Why there are no review dates
 * ---------------------------------------------------------------------------
 * An earlier version made every entry expire on a calendar date, which turned
 * a low-maintenance repo into one with a scheduled CI failure and busywork
 * attached. For this project that trade is wrong: nukebg ships a static,
 * fully client-side site, and none of the currently-accepted packages reach
 * it — sharp/libvips is CLI-only (a devDependency in the app that nothing
 * imports), protobufjs sits under onnxruntime-web whose parsing happens in
 * WASM, tar runs in an install script, esbuild in the dev server.
 *
 * So expiry is event-driven instead. An entry accepted *because no fix exists*
 * fails the moment npm reports one — the exact moment action becomes possible,
 * rather than an arbitrary date. Entries accepted for other reasons stay
 * accepted until a NEW advisory shows up in that package, which the gate still
 * catches. Nothing here needs a calendar.
 */

/** Reasons an entry can give for being on the list. */
export const ACCEPTED_BECAUSE = Object.freeze({
  /** Upstream has published nothing to upgrade to. Re-fails when it does. */
  NO_FIX: 'no-fix-available',
  /** A fix exists but was deliberately not taken; `why-accepted` says why. */
  FIX_REJECTED: 'fix-exists-but-not-taken',
});

const REASONS = new Set(Object.values(ACCEPTED_BECAUSE));

/**
 * Advisory IDs npm reports for one finding.
 *
 * `via` holds advisory objects for a package's own vulnerabilities and plain
 * strings when the finding is inherited from a dependency (sharp ->
 * @huggingface/transformers), so a purely transitive finding has no IDs.
 */
export function advisoryIds(finding) {
  return (finding.via ?? [])
    .filter((x) => typeof x === 'object' && x !== null)
    .map((x) => (typeof x.url === 'string' ? x.url.split('/').pop() : String(x.source ?? '')))
    .filter(Boolean);
}

/** npm reports `false`, or a truthy object/true, for fixAvailable. */
function hasFix(finding) {
  return finding.fixAvailable !== undefined && finding.fixAvailable !== false;
}

/**
 * Decide whether an audit result is acceptable given the allowlist.
 *
 * @param {object} audit  parsed `npm audit --json`
 * @param {Array}  entries  `.audit-allowlist.json` entries
 * @returns {{ok: boolean, accepted: Array, unlisted: Array, undeclared: Array, fixNowAvailable: Array, malformed: Array, stale: Array}}
 */
export function evaluate(audit, entries) {
  const malformed = [];
  for (const e of entries) {
    if (typeof e?.package !== 'string' || e.package === '') {
      malformed.push(`entry with no package name: ${JSON.stringify(e)?.slice(0, 60)}`);
      continue;
    }
    if (!REASONS.has(e.acceptedBecause)) {
      malformed.push(
        `${e.package}: acceptedBecause must be one of ${[...REASONS].join(' | ')}, got ${JSON.stringify(e.acceptedBecause)}`,
      );
    }
    if (!Array.isArray(e.advisories)) {
      malformed.push(
        `${e.package}: advisories must be an array (use [] for a purely transitive finding)`,
      );
    }
  }

  const found = Object.values(audit.vulnerabilities ?? {}).filter(
    (v) => v.severity && v.severity !== 'info',
  );

  const allowed = new Map(entries.filter((e) => e?.package).map((e) => [e.package, e]));
  const accepted = [];
  const unlisted = [];
  const undeclared = [];
  const fixNowAvailable = [];

  for (const v of found) {
    const entry = allowed.get(v.name);
    if (!entry) {
      unlisted.push(v);
      continue;
    }

    // Match on advisory IDs, not just the package name.
    //
    // The first version keyed on package name alone, which made the
    // `advisories` list decorative: a brand-new CRITICAL in an already-listed
    // package sailed straight through, printed as "accepted". That is exactly
    // the arrival this gate exists to catch.
    const ids = advisoryIds(v);
    const declared = new Set(entry.advisories ?? []);
    const missing = ids.filter((id) => !declared.has(id));

    if (ids.length > 0 && missing.length > 0) {
      undeclared.push({ name: v.name, severity: v.severity, ids: missing });
      continue;
    }
    if (ids.length === 0 && (entry.advisories ?? []).length > 0) {
      // Purely transitive findings report no IDs. The entry must declare an
      // empty list rather than inheriting acceptance by accident.
      undeclared.push({
        name: v.name,
        severity: v.severity,
        ids: ['<transitive, but entry declares specific IDs>'],
      });
      continue;
    }

    // The justification "there is nothing to upgrade to" stops being true the
    // moment upstream publishes something. This replaces the calendar expiry:
    // it fires when action becomes possible, not on a date someone picked.
    if (entry.acceptedBecause === ACCEPTED_BECAUSE.NO_FIX && hasFix(v)) {
      fixNowAvailable.push({ name: v.name, severity: v.severity, fix: v.fixAvailable });
      continue;
    }

    accepted.push({ finding: v, entry });
  }

  const stale = entries.filter((e) => e?.package && !found.some((v) => v.name === e.package));

  return {
    ok:
      malformed.length === 0 &&
      unlisted.length === 0 &&
      undeclared.length === 0 &&
      fixNowAvailable.length === 0,
    accepted,
    unlisted,
    undeclared,
    fixNowAvailable,
    malformed,
    stale,
  };
}
