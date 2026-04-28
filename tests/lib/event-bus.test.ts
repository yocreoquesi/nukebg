import { describe, it, expect, vi } from 'vitest';
import { emit, on } from '../../src/lib/event-bus';

/**
 * Behavioural tests for the typed event-bus helpers (#217).
 *
 * Type-level correctness is enforced by tsc via `npm run typecheck` —
 * these tests verify the runtime shape: emit dispatches a CustomEvent
 * with the right name/detail, on() unwraps the detail, and AbortSignal
 * unsubscribes cleanly.
 */

describe('event-bus', () => {
  describe('emit + on round-trip', () => {
    it('delivers the detail payload to the handler', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      const handler = vi.fn();

      on(target, 'batch:item-click', handler, { signal: ac.signal });
      emit(target, 'batch:item-click', { id: 'x', state: 'pending' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ id: 'x', state: 'pending' });
    });

    it('passes the wrapping CustomEvent as second arg for callers that need bubbles/target', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      const handler = vi.fn();

      on(target, 'batch:item-click', handler, { signal: ac.signal });
      emit(target, 'batch:item-click', { id: 'x', state: 'pending' });

      const ce = handler.mock.calls[0][1];
      expect(ce.type).toBe('batch:item-click');
      expect(ce.detail).toEqual({ id: 'x', state: 'pending' });
    });

    it('handles undefined-detail events (CustomEvent normalizes to null per spec)', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      const handler = vi.fn();

      on(target, 'ar:cancel-processing', handler, { signal: ac.signal });
      emit(target, 'ar:cancel-processing', undefined);

      expect(handler).toHaveBeenCalledTimes(1);
      // CustomEvent ctor coerces `detail: undefined` to null. Documenting
      // the runtime contract so consumers know not to do strict-equal
      // checks against undefined for void events.
      expect(handler.mock.calls[0][0]).toBeNull();
    });
  });

  describe('AbortSignal cleanup', () => {
    it('stops delivering after the signal aborts', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      const handler = vi.fn();

      on(target, 'nukebg:locale-changed', handler, { signal: ac.signal });
      emit(target, 'nukebg:locale-changed', { locale: 'en' });
      ac.abort();
      emit(target, 'nukebg:locale-changed', { locale: 'es' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].locale).toBe('en');
    });

    it('multiple listeners on the same target detach independently', () => {
      const target = new EventTarget();
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const h1 = vi.fn();
      const h2 = vi.fn();

      on(target, 'nukebg:locale-changed', h1, { signal: ac1.signal });
      on(target, 'nukebg:locale-changed', h2, { signal: ac2.signal });

      emit(target, 'nukebg:locale-changed', { locale: 'en' });
      ac1.abort();
      emit(target, 'nukebg:locale-changed', { locale: 'es' });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(2);
    });
  });

  describe('emit options', () => {
    it('defaults bubbles and composed to false', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      let captured: CustomEvent | null = null;
      on(
        target,
        'ar:nuke-success',
        (_detail, ce) => {
          captured = ce;
        },
        { signal: ac.signal },
      );

      emit(target, 'ar:nuke-success', undefined);
      expect(captured).not.toBeNull();
      expect(captured!.bubbles).toBe(false);
      expect(captured!.composed).toBe(false);
    });

    it('forwards explicit bubbles + composed to the CustomEvent', () => {
      const target = new EventTarget();
      const ac = new AbortController();
      let captured: CustomEvent | null = null;
      on(
        target,
        'batch:item-click',
        (_detail, ce) => {
          captured = ce;
        },
        { signal: ac.signal },
      );

      emit(
        target,
        'batch:item-click',
        { id: 'x', state: 'done' },
        { bubbles: true, composed: true },
      );
      expect(captured!.bubbles).toBe(true);
      expect(captured!.composed).toBe(true);
    });
  });
});
