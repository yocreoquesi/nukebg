import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #78 — Inline error-stage actions in ar-progress.
 */

const ROOT = resolve(__dirname, '..', '..');
const PROG = readFileSync(resolve(ROOT, 'src/components/ar-progress.ts'), 'utf8');
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('inline error-stage actions (#78)', () => {
  it('ar-progress renders retry / report / reload buttons when a stage errors', () => {
    expect(PROG).toMatch(/s\.status === ['"]error['"]/);
    expect(PROG).toMatch(/class="stage-action stage-action-retry"/);
    expect(PROG).toMatch(/class="stage-action stage-action-report"/);
    expect(PROG).toMatch(/class="stage-action stage-action-reload"/);
    expect(PROG).toMatch(/t\(['"]error\.retry['"]\)/);
    expect(PROG).toMatch(/t\(['"]error\.report['"]\)/);
    expect(PROG).toMatch(/t\(['"]error\.reload['"]\)/);
  });

  it('ar-progress delegates clicks to composed CustomEvents (retry/report) and reloads directly', () => {
    expect(PROG).toMatch(/ar:stage-retry[\s\S]*?bubbles: true,\s*composed: true/);
    expect(PROG).toMatch(/ar:stage-report[\s\S]*?bubbles: true,\s*composed: true/);
    expect(PROG).toMatch(/stage-action-reload[\s\S]*?location\.reload\(\)/);
  });

  it('retry button gets the accent-primary variant', () => {
    expect(PROG).toMatch(/\.stage-action-retry \{[\s\S]*?color: var\(--color-accent-primary/);
  });

  it('ar-app wires ar:stage-retry -> retryFromError and ar:stage-report -> GitHub issue URL', () => {
    expect(APP).toMatch(/ar:stage-retry[\s\S]*?retryFromError\(\)/);
    expect(APP).toMatch(/ar:stage-report[\s\S]*?github\.com\/yocreoquesi\/nukebg\/issues\/new\?/);
    // UA + locale still travel with the report, now as form fields.
    expect(APP).toMatch(/ua: navigator\.userAgent/);
    expect(APP).toMatch(/locale: document\.documentElement\.lang/);
  });

  it('the report button targets the issue form instead of overwriting its body', () => {
    expect(APP).toMatch(/template: 'pipeline-error\.yml'/);
    // A `body` parameter replaces the whole template. That is how #375
    // arrived with none of the template's sections in it: the reporter
    // silently overwrote them, so the only path that produces real bug
    // reports was also the one path that skipped every question the
    // template asked.
    //
    // Asserted against the parameter object rather than the surrounding
    // source, so the prose explaining this does not trip its own check.
    const params = APP.match(/new URLSearchParams\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
    expect(params, 'reporter no longer builds a URLSearchParams').not.toBe('');
    expect(params).not.toMatch(/^\s*body\s*:/m);
  });

  it('every field the reporter prefills exists in the form it targets', () => {
    // Cross-file invariant: GitHub prefills a form field by its `id`, and
    // silently ignores a parameter that matches nothing. Rename an id in
    // the .yml and the app keeps building a URL that looks right and
    // quietly drops the value — no error, anywhere.
    const form = readFileSync(
      resolve(ROOT, '..', '..', '.github', 'ISSUE_TEMPLATE', 'pipeline-error.yml'),
      'utf8',
    );
    const formIds = new Set(Array.from(form.matchAll(/^\s+id:\s*(\S+)/gm), (m) => m[1]));

    const params = APP.match(/new URLSearchParams\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
    const prefilled = Array.from(params.matchAll(/^\s*(\w+)[,:]/gm), (m) => m[1])
      // `template` and `title` are GitHub's own parameters, not form fields.
      .filter((k) => k !== 'template' && k !== 'title');

    expect(
      prefilled.length,
      'reporter prefills nothing — did the URL shape change?',
    ).toBeGreaterThan(0);
    for (const key of prefilled) {
      expect(formIds, `pipeline-error.yml has no field with id "${key}"`).toContain(key);
    }
  });

  it('every ?template= link points at a form that exists', () => {
    // Same cross-file invariant as above, from the other direction. A link
    // to a missing template silently drops the reader on the generic issue
    // chooser instead of the form — no 404, no signal. The README carried
    // exactly that for the length of this change: it still pointed at the
    // old `.md` names after they were replaced.
    const TEMPLATE_DIR = resolve(ROOT, '..', '..', '.github', 'ISSUE_TEMPLATE');
    const sources = [
      ['README.md', readFileSync(resolve(ROOT, '..', '..', 'README.md'), 'utf8')],
      ['ar-app.ts', APP],
    ] as const;

    let checked = 0;
    for (const [name, text] of sources) {
      for (const [, tpl] of text.matchAll(/template[=:]\s*'?([\w.-]+\.(?:yml|md))'?/g)) {
        checked++;
        expect(existsSync(resolve(TEMPLATE_DIR, tpl)), `${name} links to missing ${tpl}`).toBe(
          true,
        );
      }
    }
    expect(checked, 'no ?template= links found — did the link shape change?').toBeGreaterThan(0);
  });

  it('i18n parity — error.retry / error.report / error.reload in all six locales', () => {
    for (const key of ['error.retry', 'error.report', 'error.reload']) {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g');
      expect((I18N.match(re) ?? []).length, key).toBe(6);
    }
  });

  it('coarse-pointer bumps .stage-action to ≥ 40 px min-height', () => {
    expect(PROG).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.stage-action \{ min-height: 40px/);
  });
});
