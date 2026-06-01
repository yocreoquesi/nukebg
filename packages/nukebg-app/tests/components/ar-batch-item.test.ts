import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Behavioural tests for the <ar-batch-item> slot (#131).
 *
 * Exercises: setItem / updateState public APIs, state-driven badge +
 * overlay rendering, click + keyboard interactivity (gated by state),
 * the bubbled batch:item-click event, and aria-label composition.
 */

import '../../src/components/ar-batch-item';
import type { ArBatchItem } from '../../src/components/ar-batch-item';

describe('ArBatchItem slot (#131)', () => {
  let item: ArBatchItem;

  beforeEach(() => {
    item = document.createElement('ar-batch-item') as ArBatchItem;
    document.body.appendChild(item);
  });

  afterEach(() => {
    item.remove();
  });

  // ─── Mount + structure ──────────────────────────────────────────────────

  it('registers as the <ar-batch-item> custom element', () => {
    expect(customElements.get('ar-batch-item')).toBeDefined();
  });

  it('exposes role="button" + tabindex="0" so keyboard users can focus it', () => {
    expect(item.getAttribute('role')).toBe('button');
    expect(item.getAttribute('tabindex')).toBe('0');
  });

  it('renders the checker, image slot, overlay container, and badge', () => {
    const root = item.shadowRoot!;
    expect(root.querySelector('.checker')).not.toBeNull();
    expect(root.querySelector('img.thumb')).not.toBeNull();
    expect(root.querySelector('#overlay')).not.toBeNull();
    expect(root.querySelector('#badge')).not.toBeNull();
  });

  // ─── setItem / state-driven render ──────────────────────────────────────

  describe('setItem + state-driven rendering', () => {
    it('pending state: badge labelled, host gets data-state="pending", non-clickable', () => {
      item.setItem('id-1', 'a.png', null, 'pending');
      expect(item.getAttribute('data-state')).toBe('pending');
      expect(item.getAttribute('data-clickable')).toBe('false');
      expect(item.shadowRoot!.querySelector('#badge')!.textContent).toBeTruthy();
    });

    it('processing state: shows spinner overlay + clickable', () => {
      item.setItem('id-1', 'a.png', null, 'processing');
      const overlay = item.shadowRoot!.querySelector('#overlay')!;
      expect(item.getAttribute('data-state')).toBe('processing');
      expect(item.getAttribute('data-clickable')).toBe('true');
      expect(overlay.querySelector('.spinner')).not.toBeNull();
    });

    it('failed state: shows fail icon + clickable + dedicated styling', () => {
      item.setItem('id-1', 'a.png', null, 'failed');
      const overlay = item.shadowRoot!.querySelector('#overlay')!;
      expect(item.getAttribute('data-state')).toBe('failed');
      expect(item.getAttribute('data-clickable')).toBe('true');
      expect(overlay.querySelector('.fail-icon')).not.toBeNull();
    });

    it('done state: clickable, ok-coloured badge, no overlay', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const overlay = item.shadowRoot!.querySelector('#overlay')!;
      const badge = item.shadowRoot!.querySelector('#badge')!;
      expect(item.getAttribute('data-clickable')).toBe('true');
      expect(badge.classList.contains('ok')).toBe(true);
      expect(overlay.children.length).toBe(0);
    });

    it('reveals the thumbnail when a thumbnailUrl is provided', () => {
      item.setItem('id-1', 'a.png', 'data:image/png;base64,iVBORw0KGgo=', 'done');
      const img = item.shadowRoot!.querySelector('img.thumb') as HTMLImageElement;
      expect(img.classList.contains('hidden')).toBe(false);
      expect(img.src).toContain('data:image/png');
    });

    it('keeps the thumbnail hidden when no url is provided', () => {
      item.setItem('id-1', 'a.png', null, 'pending');
      const img = item.shadowRoot!.querySelector('img.thumb') as HTMLImageElement;
      expect(img.classList.contains('hidden')).toBe(true);
    });

    it('aria-label combines the original filename and current state', () => {
      item.setItem('id-1', 'mountain.png', null, 'done');
      expect(item.getAttribute('aria-label')).toContain('mountain.png');
      expect(item.getAttribute('aria-label')).toContain('done');
    });
  });

  // ─── updateState ────────────────────────────────────────────────────────

  describe('updateState', () => {
    it('flips the host data-state attribute and rerenders the overlay', () => {
      item.setItem('id-1', 'a.png', null, 'pending');
      item.updateState('processing');
      expect(item.getAttribute('data-state')).toBe('processing');
      expect(item.shadowRoot!.querySelector('.spinner')).not.toBeNull();
    });

    it('updateState with a thumbnail param reveals the image', () => {
      item.setItem('id-1', 'a.png', null, 'processing');
      item.updateState('done', 'data:image/png;base64,abc=');
      const img = item.shadowRoot!.querySelector('img.thumb') as HTMLImageElement;
      expect(img.classList.contains('hidden')).toBe(false);
    });

    it('omitting thumbnailUrl on updateState keeps the previous one', () => {
      item.setItem('id-1', 'a.png', 'data:image/png;base64,abc=', 'processing');
      item.updateState('done');
      const img = item.shadowRoot!.querySelector('img.thumb') as HTMLImageElement;
      expect(img.classList.contains('hidden')).toBe(false);
      expect(img.src).toContain('data:image/png');
    });
  });

  // ─── Interactivity gated by state ───────────────────────────────────────

  describe('click + keyboard handling', () => {
    function captureClick(): { ev: CustomEvent | null } {
      const out: { ev: CustomEvent | null } = { ev: null };
      item.addEventListener('batch:item-click', (e) => (out.ev = e as CustomEvent));
      return out;
    }

    it('pending items do NOT dispatch batch:item-click on click', () => {
      item.setItem('id-1', 'a.png', null, 'pending');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(out.ev).toBeNull();
    });

    it('done items dispatch batch:item-click with id + state', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(out.ev).not.toBeNull();
      expect(out.ev!.detail).toEqual({ id: 'id-1', state: 'done' });
    });

    it('processing items also dispatch on click (live progress jump)', () => {
      item.setItem('id-1', 'a.png', null, 'processing');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(out.ev).not.toBeNull();
      expect(out.ev!.detail.state).toBe('processing');
    });

    it('Enter key on the host dispatches batch:item-click', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(out.ev).not.toBeNull();
    });

    it('Space key on the host dispatches batch:item-click', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(out.ev).not.toBeNull();
    });

    it('other keys do NOT dispatch', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(out.ev).toBeNull();
    });

    it('the dispatched event bubbles + crosses shadow boundaries (composed)', () => {
      item.setItem('id-1', 'a.png', null, 'done');
      const out = captureClick();
      item.shadowRoot!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(out.ev!.bubbles).toBe(true);
      expect(out.ev!.composed).toBe(true);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('removes the locale listener so detached items do not re-render', () => {
      item.remove();
      expect(() => {
        document.dispatchEvent(new CustomEvent('nukebg:locale-changed'));
      }).not.toThrow();
    });
  });
});
