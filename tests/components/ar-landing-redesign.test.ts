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
const APP = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
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
