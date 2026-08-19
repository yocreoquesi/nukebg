import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Landing redesign invariants (#69).
 *
 * ar-app is too heavy to mount in happy-dom (it imports PipelineOrchestrator
 * which constructs Web Workers). These tests are source-level invariants
 * that pin the four design-proposal requirements so a future edit can't
 * silently regress the landing:
 *
 *   1. Full-bleed marquee with gradient edge masks (outside the 960px column).
 *   2. ASCII-framed dropzone with corner glyphs and [ ↓ ] drop indicator.
 *   3. Consolidated [STATUS] line (reactor + model + known-limitations details).
 *   4. Reactor Power control hidden from the hero/landing.
 */

const ROOT = resolve(__dirname, '..', '..');
// APP concatenates ar-app.ts + extracted modules so source-level invariants
// still hold after the #254 refactor (CSS → ar-app.styles.ts, HTML template
// → ar-app.template.ts).
const APP = [
  readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8'),
  readFileSync(resolve(ROOT, 'src/components/ar-app.styles.ts'), 'utf8'),
  readFileSync(resolve(ROOT, 'src/components/ar-app.template.ts'), 'utf8'),
].join('\n');
const DZ = readFileSync(resolve(ROOT, 'src/components/ar-dropzone.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('Landing redesign — ar-app.ts invariants', () => {
  it('renders a full-bleed marquee (.marquee-bleed) outside the 960 column', () => {
    expect(APP).toMatch(/id="precision-marquee-bleed"/);
    expect(APP).toMatch(/\.marquee-bleed\s*\{/);
    // Gradient mask at both edges
    expect(APP).toMatch(/mask-image:\s*linear-gradient\(90deg,\s*transparent,\s*#000 48px/);
    expect(APP).toMatch(/-webkit-mask-image:\s*linear-gradient\(90deg,\s*transparent,\s*#000 48px/);
  });

  it('mounts the consolidated [STATUS] line with reactor + model + details', () => {
    expect(APP).toMatch(/id="status-line"/);
    expect(APP).toMatch(/id="status-reactor"/);
    expect(APP).toMatch(/id="status-model"/);
    // native <details> disclosure for limitations
    expect(APP).toMatch(/id="status-limits-summary"/);
    expect(APP).toMatch(/<details class="status-details">/);
  });

  it('no longer mounts the legacy model-status / features-disclaimer / reactor-support elements', () => {
    expect(APP).not.toMatch(/id="model-status"/);
    expect(APP).not.toMatch(/id="features-disclaimer"/);
    expect(APP).not.toMatch(/id="reactor-support"/);
    expect(APP).not.toMatch(/id="limitations-detail"/);
  });

  it('does NOT render the Reactor Power control inside the hero', () => {
    // Hero section body: from `<section class="hero"` to the closing `</section>`
    const heroMatch = APP.match(/<section class="hero"[\s\S]*?<\/section>/);
    expect(heroMatch).not.toBeNull();
    expect(heroMatch![0]).not.toMatch(/renderReactorSegmented\(['"]hero['"]\)/);
    expect(heroMatch![0]).not.toMatch(/\bid="precision-slider"/);
    expect(heroMatch![0]).not.toMatch(/\bclass="hero-controls"/);
  });
});

describe('Landing redesign — ar-dropzone.ts invariants', () => {
  it('drops the cloud Unicode glyph (&#9729; / ☁)', () => {
    expect(DZ).not.toMatch(/&#9729;/);
    expect(DZ).not.toMatch(/☁/);
  });

  it('renders four ASCII corner glyphs (┌ ┐ └ ┘) absolutely positioned', () => {
    expect(DZ).toMatch(/class="dz-corner tl"/);
    expect(DZ).toMatch(/class="dz-corner tr"/);
    expect(DZ).toMatch(/class="dz-corner bl"/);
    expect(DZ).toMatch(/class="dz-corner br"/);
    // Their Unicode entities
    expect(DZ).toMatch(/&#9484;/); // ┌
    expect(DZ).toMatch(/&#9488;/); // ┐
    expect(DZ).toMatch(/&#9492;/); // └
    expect(DZ).toMatch(/&#9496;/); // ┘
  });

  it('renders the [ ↓ ] drop-indicator glyph in a bordered box', () => {
    expect(DZ).toMatch(/class="dz-glyph"/);
    // Down-arrow entity
    expect(DZ).toMatch(/&#8595;/);
  });

  it('has a terminal prompt row (nukebg@local:~$ drop --image)', () => {
    expect(DZ).toMatch(/nukebg@local:~\$ <span class="cmd">drop --image<\/span>/);
  });

  it('has a bottom meta row with formats on left and batch hint on right', () => {
    expect(DZ).toMatch(/class="dz-foot"/);
    expect(DZ).toMatch(/id="dz-formats"/);
    expect(DZ).toMatch(/id="dz-multi"/);
  });

  it('outer dropzone border uses accent-primary (not surface-border) + glow shadow', () => {
    expect(DZ).toMatch(/border:\s*1px solid var\(--color-accent-primary/);
    expect(DZ).toMatch(
      /box-shadow:\s*\n?\s*0 0 14px rgba\(var\(--color-accent-rgb[^)]+\),\s*0\.08\)/,
    );
  });

  it('mobile dropzone gets min-height: 44vh so it occupies most of the viewport', () => {
    expect(DZ).toMatch(/@media \(max-width: 480px\)[^}]*\.dropzone\s*\{[^}]*min-height:\s*44vh/s);
  });
});

describe('Landing redesign — i18n invariants', () => {
  const keys = [
    'status.reactor.online',
    'status.model.cached',
    'status.limitations',
    'dropzone.hint',
  ];
  for (const key of keys) {
    it(`has '${key}' in all six locales`, () => {
      const matches = I18N.match(new RegExp(`'${key.replace(/\./g, '\\.')}'\\s*:`, 'g')) ?? [];
      expect(matches.length).toBe(6);
    });
  }
});

/**
 * #354 — the four blocks under the dropzone must not collapse back into
 * one undifferentiated grey-green paragraph.
 *
 * #69 consolidated the [STATUS] line itself but left the copy around it
 * at the same 12px tertiary as the status line, the Ko-fi pitch and the
 * limitations body. This pins the ramp by role, not by decoration.
 */
describe('landing status area — ranked, not flat (#354)', () => {
  /** Pull a single CSS rule body out of the concatenated app source. */
  function rule(selector: string): string {
    const at = APP.indexOf(`${selector} {`);
    expect(at, `rule not found: ${selector}`).toBeGreaterThan(-1);
    const end = APP.indexOf('}', at);
    return APP.slice(at, end);
  }

  it('the disclaimer reads as body — it is the one that tells you what to do', () => {
    expect(rule('.hero-disclaimer')).toMatch(/color: var\(--color-text-secondary/);
  });

  it('the Ko-fi pitch stays quiet and keeps its own spacing', () => {
    const support = rule('.hero-support');
    expect(support).toMatch(/color: var\(--color-text-tertiary/);
    // Separated from the disclaimer so it reads as a different message
    // rather than a fourth line of the same paragraph.
    expect(support).toMatch(/margin: 14px 0 0/);
  });

  it('the two carry different colours — that is the whole point', () => {
    // The regression this guards is re-merging them into one rule, or
    // otherwise letting all four blocks land on the same token again.
    // Asserting the colours DIFFER survives any refactor of how the
    // rules are written.
    const disclaimer = rule('.hero-disclaimer');
    const support = rule('.hero-support');
    const colourOf = (css: string) => css.match(/--color-text-[a-z]+/)?.[0];
    expect(colourOf(disclaimer)).toBeDefined();
    expect(colourOf(support)).toBeDefined();
    expect(colourOf(disclaimer)).not.toBe(colourOf(support));
  });

  it('contrast is never lowered — tertiary keeps its WCAG-bumped value', () => {
    // main.css raised tertiary to #00b34a deliberately for AA/AAA. The
    // ramp must move text UP the scale, never dim it further.
    expect(rule('.hero-support')).not.toContain('opacity');
    expect(rule('.hero-disclaimer')).not.toContain('opacity');
  });
});
