import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep, basename, dirname } from 'node:path';

/**
 * No module under src/ should be unreachable from the entry point (#392).
 *
 * `src/lib/brush-stroke.ts` was extracted from `ar-editor.ts` in #47, and
 * `ar-editor.ts` was deleted in e0c9930 — "delete ar-editor.ts, which no user
 * could reach". The helper outlived its only consumer by months, and its own
 * test suite kept it green the whole time.
 *
 * That is the failure mode worth guarding: a passing suite is the strongest
 * signal a module is alive, so dead code with tests is the kind that survives
 * a deletion pass. Tree-shaking keeps it out of the bundle, so it costs users
 * nothing and readers something — which is exactly why nothing ever prompts a
 * re-read. The sweep that found it also turned up `src/types/index.ts`, a
 * barrel nobody imported; both were removed in #392.
 *
 * Reachability here is textual, not a real module graph: a file counts as
 * reachable if any other source file mentions its path in an import, a
 * side-effect import, or a `new Worker(new URL(...))`. That is enough for
 * this codebase and needs no dependency. It errs towards calling things
 * reachable, so a failure here is worth trusting.
 */

const SRC = resolve(__dirname, '..', 'src');

/** The only file loaded from outside the module graph — see index.html. */
const ENTRY = 'main.ts';

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no orphan modules under src/ (#392)', () => {
  const files = tsFilesUnder(SRC).map((f) => ({
    abs: f,
    rel: f
      .slice(SRC.length + 1)
      .split(sep)
      .join('/'),
    text: readFileSync(f, 'utf8'),
  }));

  it('finds a source tree at all — a zero here would make the next test vacuous', () => {
    // The first run of this sweep was executed from the wrong directory,
    // walked nothing, and reported a clean result. Never again.
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => f.rel)).toContain(ENTRY);
  });

  it('every module is referenced by another module', () => {
    const orphans = files
      .filter((f) => f.rel !== ENTRY && !f.rel.endsWith('.d.ts'))
      .filter((f) => {
        // Three reference shapes exist here:
        //   import './components/ar-app'          — no extension
        //   new URL('../workers/cv.worker.ts')    — with extension, because
        //                                           Vite needs it to emit
        //                                           the worker chunk
        //   import { t } from '../i18n'           — a directory, resolving
        //                                           to that dir's index.ts
        const stem = basename(f.rel, '.ts');
        const needles =
          stem === 'index'
            ? [`/${basename(dirname(f.rel))}'`, `/index'`, `/index.ts'`]
            : [`/${stem}'`, `/${stem}.ts'`];
        return !files.some(
          (other) => other.abs !== f.abs && needles.some((n) => other.text.includes(n)),
        );
      })
      .map((f) => f.rel);

    expect(
      orphans,
      'unreachable from src/main.ts — delete it, or wire it up if it was meant to be used',
    ).toEqual([]);
  });
});
