/**
 * The audit gate's decision logic, as a pure function.
 *
 * Split out of audit-gate.mjs so it can be unit-tested against fixtures. The
 * first version of the gate had two holes that only surfaced because someone
 * probed the running script by hand — matching on package name alone, so a new
 * advisory in an already-listed package sailed through as "accepted", and an
 * entry with no `reviewBy` comparing `undefined < today` and never expiring.
 *
 * Hand-probes prove a gate works today. Tests prove it still works after the
 * next edit, which is the part that matters for something whose whole job is
 * to fail when nobody is watching.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Decide whether an audit result is acceptable given the allowlist.
 *
 * @param {object} audit  parsed `npm audit --json`
 * @param {Array}  entries  `.audit-allowlist.json` entries
 * @param {string} today  YYYY-MM-DD
 * @returns {{ok: boolean, accepted: Array, unlisted: Array, undeclared: Array, expired: Array, malformed: Array, stale: Array}}
 */
export function evaluate(audit, entries, today) {
  const malformed = [];
  for (const e of entries) {
    if (typeof e?.package !== 'string' || e.package === '') {
      malformed.push(`entry with no package name: ${JSON.stringify(e)?.slice(0, 60)}`);
      continue;
    }
    if (!DATE.test(e.reviewBy ?? '')) {
      malformed.push(
        `${e.package}: reviewBy must be YYYY-MM-DD, got ${JSON.stringify(e.reviewBy)}`,
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

  for (const v of found) {
    const entry = allowed.get(v.name);
    if (!entry) {
      unlisted.push(v);
      continue;
    }

    const ids = advisoryIds(v);
    const declared = new Set(entry.advisories ?? []);
    const missing = ids.filter((id) => !declared.has(id));

    if (ids.length === 0) {
      // Purely transitive. The entry must declare an empty list rather than
      // inheriting acceptance by accident.
      if ((entry.advisories ?? []).length === 0) accepted.push({ finding: v, entry });
      else
        undeclared.push({
          name: v.name,
          severity: v.severity,
          ids: ['<transitive, but entry declares specific IDs>'],
        });
    } else if (missing.length > 0) {
      undeclared.push({ name: v.name, severity: v.severity, ids: missing });
    } else {
      accepted.push({ finding: v, entry });
    }
  }

  const expired = entries.filter((e) => DATE.test(e.reviewBy ?? '') && e.reviewBy < today);
  const stale = entries.filter(
    (e) => e?.package && !found.some((v) => v.name === e.package),
  );

  return {
    ok: malformed.length === 0 && unlisted.length === 0 && undeclared.length === 0 && expired.length === 0,
    accepted,
    unlisted,
    undeclared,
    expired,
    malformed,
    stale,
  };
}
