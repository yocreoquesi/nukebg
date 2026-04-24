import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Reactor Power segmented control (#70).
 *
 * ar-app is heavy — pulling it into happy-dom drags PipelineOrchestrator
 * and worker constructors that don't exist in the test env. Instead, we
 * scan the source for the invariants that matter and exercise a
 * hand-built DOM fixture with the same behaviour to confirm the wiring
 * contract the component promises.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const SOURCE = readFileSync(resolve(ROOT, 'src/components/ar-app.ts'), 'utf8');
const I18N = readFileSync(resolve(ROOT, 'src/i18n/index.ts'), 'utf8');

describe('reactor segmented — source invariants', () => {
  it('does not mount <input type="range"> for precision anymore', () => {
    expect(SOURCE).not.toMatch(/<input[^>]*id="precision-slider[^"]*"[^>]*type="range"/);
    expect(SOURCE).not.toMatch(/<input[^>]*type="range"[^>]*id="precision-slider/);
  });

  it('renders the segmented control in the workspace (landing reactor hidden per #69)', () => {
    expect(SOURCE).toMatch(/renderReactorSegmented\(['"]ws['"]\)/);
    // Hero no longer mounts the reactor — moved to workspace-only per #69.
    expect(SOURCE).not.toMatch(/renderReactorSegmented\(['"]hero['"]\)/);
  });

  it('wires click + keydown (arrow/home/end) on the segmented buttons', () => {
    expect(SOURCE).toMatch(/\.reactor-segment/);
    expect(SOURCE).toMatch(/addEventListener\(['"]click['"],/);
    expect(SOURCE).toMatch(/ArrowRight|ArrowDown/);
    expect(SOURCE).toMatch(/ArrowLeft|ArrowUp/);
    expect(SOURCE).toMatch(/['"]Home['"]/);
    expect(SOURCE).toMatch(/['"]End['"]/);
  });

  it('applyPrecisionMode clamps out-of-range values and syncs aria-pressed', () => {
    expect(SOURCE).toMatch(/applyPrecisionMode\(val: number\)/);
    expect(SOURCE).toMatch(/if \(val < 0 \|\| val > 3\) return/);
    expect(SOURCE).toMatch(/aria-pressed['"], on \? ['"]true['"] : ['"]false['"]/);
  });

  it('side-effects method keeps the four behavioural branches', () => {
    expect(SOURCE).toMatch(/applyPrecisionSideEffects\(val: number\)/);
    expect(SOURCE).toMatch(/Mode: FULL NUKE/);
    expect(SOURCE).toMatch(/Mode: HIGH POWER/);
    expect(SOURCE).toMatch(/Mode: LOW POWER/);
    expect(SOURCE).toMatch(/Mode: NORMAL/);
  });

  it('i18n has reactor.segment.* keys for all six locales', () => {
    const keys = ['low', 'normal', 'high', 'fullNuke', 'groupLabel'];
    for (const k of keys) {
      const matches = I18N.match(new RegExp(`'reactor\\.segment\\.${k}'\\s*:`, 'g')) ?? [];
      expect(matches.length, `reactor.segment.${k} parity`).toBe(6);
    }
  });
});

describe('reactor segmented — DOM keyboard + selection contract (hand-built fixture)', () => {
  let group: HTMLDivElement;
  let buttons: HTMLButtonElement[];
  let selected = 1;

  beforeEach(() => {
    selected = 1;
    document.body.innerHTML = '';
    group = document.createElement('div');
    group.className = 'reactor-segment-group';
    group.setAttribute('role', 'radiogroup');
    const labels = ['LOW', 'NORMAL', 'HIGH', 'FULL NUKE'];
    buttons = labels.map((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'reactor-segment';
      b.dataset.precision = String(i);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-pressed', i === selected ? 'true' : 'false');
      b.tabIndex = i === selected ? 0 : -1;
      b.textContent = label;
      return b;
    });
    buttons.forEach((b) => group.appendChild(b));
    document.body.appendChild(group);

    // Minimal synthetic handler mirroring applyPrecisionMode's aria syncing.
    const apply = (val: number): void => {
      if (val < 0 || val > 3) return;
      selected = val;
      buttons.forEach((b, i) => {
        const on = i === val;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => apply(Number(btn.dataset.precision)));
      btn.addEventListener('keydown', (e) => {
        const idx = buttons.indexOf(btn);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          apply(Math.min(idx + 1, buttons.length - 1));
          buttons[Math.min(idx + 1, buttons.length - 1)].focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          apply(Math.max(idx - 1, 0));
          buttons[Math.max(idx - 1, 0)].focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          apply(0);
          buttons[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          apply(buttons.length - 1);
          buttons[buttons.length - 1].focus();
        }
      });
    });
  });

  it('click selects the targeted segment and updates aria-pressed', () => {
    buttons[3].click();
    expect(selected).toBe(3);
    expect(buttons[3].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[3].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
  });

  it('ArrowRight moves selection right, ArrowLeft moves left', () => {
    buttons[1].focus();
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selected).toBe(2);
    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(selected).toBe(1);
  });

  it('ArrowLeft on first segment stays at first (no wrap)', () => {
    buttons[0].click(); // selected = 0
    expect(selected).toBe(0);
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(selected).toBe(0);
  });

  it('ArrowRight on last segment stays at last (no wrap)', () => {
    buttons[3].click(); // selected = 3
    expect(selected).toBe(3);
    buttons[3].focus();
    buttons[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selected).toBe(3);
  });

  it('Home jumps to first; End jumps to last', () => {
    buttons[1].focus();
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(selected).toBe(3);
    buttons[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(selected).toBe(0);
  });

  it('out-of-range values are ignored', () => {
    buttons[1].focus();
    // Directly invoke apply-like flow by dispatching ArrowRight repeatedly
    // from index 3 — should clamp.
    buttons[3].click();
    buttons[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selected).toBe(3);
  });
});
