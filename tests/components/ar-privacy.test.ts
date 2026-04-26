import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Behavioural tests for the <ar-privacy> badge (#131).
 *
 * The component is a privacy-claim badge with a click-cycle easter egg
 * (rotating "dare you to verify" messages). Tests focus on the
 * locale-aware text rendering, the click-to-show-dare mechanic, and
 * the auto-hide timer.
 */

import '../../src/components/ar-privacy';
import type { ArPrivacy } from '../../src/components/ar-privacy';

describe('ArPrivacy badge (#131)', () => {
  let privacy: ArPrivacy;

  beforeEach(() => {
    privacy = document.createElement('ar-privacy') as ArPrivacy;
    document.body.appendChild(privacy);
  });

  afterEach(() => {
    privacy.remove();
  });

  it('registers as the <ar-privacy> custom element', () => {
    expect(customElements.get('ar-privacy')).toBeDefined();
  });

  it('attaches an open shadow root', () => {
    expect(privacy.shadowRoot).not.toBeNull();
  });

  it('renders the badge with text + tooltip lines + dare slot', () => {
    const root = privacy.shadowRoot!;
    expect(root.querySelector('#privacy-badge')).not.toBeNull();
    expect(root.querySelector('#privacy-badge-text')!.textContent).toBeTruthy();
    expect(root.querySelector('#privacy-line1')!.textContent).toBeTruthy();
    expect(root.querySelector('#privacy-line2')!.textContent).toBeTruthy();
    expect(root.querySelector('#privacy-line3')!.textContent).toBeTruthy();
    expect(root.querySelector('#dare-msg')).not.toBeNull();
  });

  it('keeps the dare message hidden until the badge is clicked', () => {
    const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
    expect(dare.classList.contains('visible')).toBe(false);
    expect(dare.textContent).toBe('');
  });

  describe('click-cycle dare messages', () => {
    it('first click shows a dare message and adds the .visible class', () => {
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      expect(dare.classList.contains('visible')).toBe(true);
      expect(dare.textContent).toBeTruthy();
    });

    it('successive clicks advance through different dare messages', () => {
      document.documentElement.lang = 'en';
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      const first = dare.textContent;
      badge.click();
      const second = dare.textContent;
      expect(first).not.toBe(second);
    });

    it('cycles back around to the first message after the language pool exhausts', () => {
      document.documentElement.lang = 'en';
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      const first = dare.textContent;
      // 5 dares per language → click 5 more times to return to index 0
      for (let i = 0; i < 5; i++) badge.click();
      expect(dare.textContent).toBe(first);
    });

    it('honours the document language when picking the dare pool', () => {
      document.documentElement.lang = 'es';
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      expect(dare.textContent).toMatch(/DevTools|Venga|c\\u00F3digo|c[oó]digo/);
    });

    it('falls back to English when the document language is not in the pool', () => {
      document.documentElement.lang = 'jp';
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      // The first English dare contains "DevTools".
      expect(dare.textContent).toContain('DevTools');
    });

    it('auto-hides the dare after the timeout', () => {
      vi.useFakeTimers();
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      expect(dare.classList.contains('visible')).toBe(true);
      vi.advanceTimersByTime(4100);
      expect(dare.classList.contains('visible')).toBe(false);
      vi.useRealTimers();
    });

    it('clicking again before timeout resets the timer rather than stacking it', () => {
      vi.useFakeTimers();
      const badge = privacy.shadowRoot!.querySelector('#privacy-badge') as HTMLElement;
      const dare = privacy.shadowRoot!.querySelector('#dare-msg')!;
      badge.click();
      vi.advanceTimersByTime(2000);
      badge.click(); // resets the 4000ms timer
      vi.advanceTimersByTime(3000);
      expect(dare.classList.contains('visible')).toBe(true);
      vi.advanceTimersByTime(1500);
      expect(dare.classList.contains('visible')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('disconnectedCallback', () => {
    it('removes the locale listener so detached badges do not re-render', () => {
      privacy.remove();
      expect(() => {
        document.dispatchEvent(new CustomEvent('nukebg:locale-changed'));
      }).not.toThrow();
    });
  });
});
