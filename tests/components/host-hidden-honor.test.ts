import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Regression guard for the v2.9.0 production bug where the /reactor
 * page rendered inline on the home page.
 *
 * Cause: a custom element with an explicit `:host { display: block }`
 * rule overrides the browser-default `[hidden] { display: none }`. The
 * hash router sets `<ar-reactor hidden>`, but without a matching
 * `:host([hidden]) { display: none }` rule the host stays visible.
 *
 * This test mounts every page-level custom element (ar-reactor +
 * ar-post-cta) and confirms the shadow stylesheet honours the hidden
 * attribute. Add new entries below if more top-level custom elements
 * land in the page tree.
 */

beforeAll(() => {
  // ar-reactor's connectedCallback fetches /donors.json before rendering.
  // happy-dom would actually try a network call — short-circuit so the
  // shadow tree paints synchronously on the first microtask.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
    ),
  );
});

import '../../src/components/ar-reactor';
import '../../src/components/ar-post-cta';

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const HOST_HIDDEN_RULE = /:host\(\[hidden\]\)\s*\{[^}]*display:\s*none/;

describe('page-level custom elements honour the hidden attribute (#137 regression)', () => {
  describe('<ar-reactor> — /reactor transparency page', () => {
    it('shadow stylesheet declares :host([hidden]) { display: none }', async () => {
      const el = document.createElement('ar-reactor');
      document.body.appendChild(el);
      await flushAsync();
      const styleEl = el.shadowRoot!.querySelector('style');
      expect(styleEl, '<ar-reactor> must render an inline <style>').not.toBeNull();
      expect(styleEl!.textContent).toMatch(HOST_HIDDEN_RULE);
      el.remove();
    });

    it('reports hidden=true when the attribute is set', async () => {
      const el = document.createElement('ar-reactor');
      el.hidden = true;
      document.body.appendChild(el);
      await flushAsync();
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.hidden).toBe(true);
      el.remove();
    });
  });

  describe('<ar-post-cta> — post-process tip CTA', () => {
    // ar-post-cta only paints its <style> when a CTA is actively shown.
    // Drive it via the public ar:nuke-success event + fake timers so the
    // 1s "settle" delay before show() resolves immediately.
    it('shadow stylesheet declares :host([hidden]) { display: none } once a CTA is shown', () => {
      vi.useFakeTimers();
      // Force a non-dismissed empty state so the first nuke triggers
      // the first-star CTA deterministically.
      try {
        localStorage.removeItem('nukebg:cta-dismissed');
        localStorage.removeItem('nukebg:nuke-count');
      } catch {
        /* localStorage unavailable in some envs — fall through */
      }
      const el = document.createElement('ar-post-cta');
      document.body.appendChild(el);
      document.dispatchEvent(new CustomEvent('ar:nuke-success'));
      vi.advanceTimersByTime(1100);
      const styleEl = el.shadowRoot!.querySelector('style');
      expect(styleEl, '<ar-post-cta> must render <style> once a CTA is shown').not.toBeNull();
      expect(styleEl!.textContent).toMatch(HOST_HIDDEN_RULE);
      el.remove();
      vi.useRealTimers();
    });
  });
});
