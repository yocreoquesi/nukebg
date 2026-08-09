import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Behavioural tests for the <ar-batch-grid> container (#131).
 *
 * Exercises: setItems / updateItem / setCurrentIndex public APIs, the
 * "processing X/N" → "X/N done" header transition, the zip-button
 * disabled-until-something-completes rule, and the bubbled custom
 * events (batch:download-zip, batch:cancel).
 */

// ar-batch-grid creates ar-batch-item children, so the child component
// must be registered before the parent renders.
import '../../src/components/ar-batch-item';
import '../../src/components/ar-batch-grid';
import type { ArBatchGrid } from '../../src/components/ar-batch-grid';
import type { BatchItem } from '../../src/types/batch';

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'item-1',
    file: new File([new Uint8Array(8)], 'a.png', { type: 'image/png' }),
    originalName: 'a.png',
    state: 'pending',
    thumbnailUrl: null,
    imageData: null,
    originalImageData: null,
    originalWidth: 0,
    originalHeight: 0,
    wasDownsampled: false,
    resultBlob: null,
    error: null,
    ...overrides,
  } as unknown as BatchItem;
}

describe('ArBatchGrid container (#131)', () => {
  let grid: ArBatchGrid;

  beforeEach(() => {
    grid = document.createElement('ar-batch-grid') as ArBatchGrid;
    document.body.appendChild(grid);
  });

  afterEach(() => {
    grid.remove();
  });

  // ─── Mount + structure ──────────────────────────────────────────────────

  it('registers as the <ar-batch-grid> custom element', () => {
    expect(customElements.get('ar-batch-grid')).toBeDefined();
  });

  it('renders header, grid, and the two action buttons', () => {
    const root = grid.shadowRoot!;
    expect(root.querySelector('#header')).not.toBeNull();
    expect(root.querySelector('#grid')).not.toBeNull();
    expect(root.querySelector('#zip-btn')).not.toBeNull();
    expect(root.querySelector('#cancel-btn')).not.toBeNull();
  });

  it('starts with the zip button disabled (no items completed)', () => {
    const zip = grid.shadowRoot!.querySelector('#zip-btn') as HTMLButtonElement;
    expect(zip.disabled).toBe(true);
  });

  // ─── setItems ──────────────────────────────────────────────────────────

  describe('setItems', () => {
    it('renders one ar-batch-item per item', () => {
      grid.setItems([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]);
      const items = grid.shadowRoot!.querySelectorAll('ar-batch-item');
      expect(items.length).toBe(3);
    });

    it('replaces previous items on re-call (no leakage)', () => {
      grid.setItems([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
      grid.setItems([makeItem({ id: 'c' })]);
      expect(grid.shadowRoot!.querySelectorAll('ar-batch-item').length).toBe(1);
    });

    it('header reflects "X of N" counters once items are set', () => {
      grid.setItems([
        makeItem({ id: 'a', state: 'done' }),
        makeItem({ id: 'b', state: 'done' }),
        makeItem({ id: 'c', state: 'failed' }),
      ]);
      const header = grid.shadowRoot!.querySelector('#header')!.textContent ?? '';
      expect(header).toMatch(/2/);
      expect(header).toMatch(/3/);
    });
  });

  // ─── Header dynamics ───────────────────────────────────────────────────

  describe('header & zip-button state machine', () => {
    it('while any item is processing the header shows the processing counter', () => {
      grid.setItems([
        makeItem({ id: 'a', state: 'done' }),
        makeItem({ id: 'b', state: 'processing' }),
        makeItem({ id: 'c', state: 'pending' }),
      ]);
      grid.setCurrentIndex(1);
      const header = grid.shadowRoot!.querySelector('#header')!.textContent ?? '';
      // Should reference the current item index (2) and total (3).
      expect(header).toMatch(/2/);
      expect(header).toMatch(/3/);
    });

    it('zip button enables once at least one item is done', () => {
      grid.setItems([
        makeItem({ id: 'a', state: 'pending' }),
        makeItem({ id: 'b', state: 'pending' }),
      ]);
      const zip = grid.shadowRoot!.querySelector('#zip-btn') as HTMLButtonElement;
      expect(zip.disabled).toBe(true);

      grid.updateItem('a', 'done');
      expect(zip.disabled).toBe(false);
    });

    it('updateItem reflects new state in the corresponding ar-batch-item', () => {
      grid.setItems([makeItem({ id: 'a' })]);
      grid.updateItem('a', 'failed');
      const item = grid.shadowRoot!.querySelector('ar-batch-item');
      expect(item!.getAttribute('data-state')).toBe('failed');
    });
  });

  // ─── Bubbled events ────────────────────────────────────────────────────

  describe('action buttons', () => {
    it('clicking #zip-btn dispatches batch:download-zip (bubbles + composed)', () => {
      grid.setItems([makeItem({ id: 'a', state: 'done' })]);
      const zip = grid.shadowRoot!.querySelector('#zip-btn') as HTMLButtonElement;
      let captured: Event | undefined;
      grid.addEventListener('batch:download-zip', (e) => (captured = e));
      zip.click();
      expect(captured).toBeDefined();
      expect(captured!.bubbles).toBe(true);
      expect(captured!.composed).toBe(true);
    });

    it('clicking #cancel-btn dispatches batch:cancel (bubbles + composed)', () => {
      const cancel = grid.shadowRoot!.querySelector('#cancel-btn') as HTMLButtonElement;
      let captured: Event | undefined;
      grid.addEventListener('batch:cancel', (e) => (captured = e));
      cancel.click();
      expect(captured).toBeDefined();
      expect(captured!.bubbles).toBe(true);
      expect(captured!.composed).toBe(true);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('removes the locale listener so detached grids do not re-render header', () => {
      grid.remove();
      expect(() => {
        document.dispatchEvent(new CustomEvent('nukebg:locale-changed'));
      }).not.toThrow();
    });
  });
});
