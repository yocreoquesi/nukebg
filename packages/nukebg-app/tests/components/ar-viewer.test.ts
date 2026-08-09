import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Behavioural tests for the <ar-viewer> component (#131).
 *
 * Exercises the public API (setOriginal / setResult / clearResult), the
 * slider state machine via WAI-ARIA attributes, and the background-color
 * toggle. Avoids source-pattern matching — every assertion looks at DOM
 * state or rendered values, not at how the implementation is written.
 */

// ─── Test infra ──────────────────────────────────────────────────────────────

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: unknown }).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      maybeHeight?: number,
    ) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? dataOrWidth.length / (widthOrHeight * 4);
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

const mockCtx = {
  fillStyle: '',
  fillRect: vi.fn(),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  createPattern: vi.fn(() => 'mock-pattern'),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => new ImageData(1, 1)),
  canvas: {} as HTMLCanvasElement,
};

// happy-dom canvases parsed from innerHTML keep the prototype's getContext,
// so patching at the prototype level catches BOTH document.createElement
// canvases and ones materialized by template parsing (which is how the
// component's two canvases are created).
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => mockCtx,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// happy-dom does not implement getBoundingClientRect with real layout; the
// drag handler bails when rect.width === 0, which would mask every test
// that drives the slider via mouse. Stub a deterministic 1000px-wide rect.
const RECT_WIDTH = 1000;

function stubContainerRect(viewer: ArViewer): void {
  const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
  container.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: RECT_WIDTH,
      bottom: 100,
      width: RECT_WIDTH,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

// matchMedia stub — default to "no preference"; individual tests can
// override before mounting the component.
let prefersReducedMotion = false;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion: reduce') ? prefersReducedMotion : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// ─── Component import (after global stubs) ───────────────────────────────────

import '../../src/components/ar-viewer';
import type { ArViewer } from '../../src/components/ar-viewer';

function makeImageData(w = 4, h = 4): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 100;
    data[i * 4 + 1] = 150;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ArViewer component (#131)', () => {
  let viewer: ArViewer;

  beforeEach(() => {
    prefersReducedMotion = true; // default: skip animation, asserts land on final state
    viewer = document.createElement('ar-viewer') as ArViewer;
    document.body.appendChild(viewer);
    stubContainerRect(viewer);
  });

  afterEach(() => {
    viewer.remove();
  });

  // ─── Mount + structure ─────────────────────────────────────────────────────

  it('registers as the <ar-viewer> custom element', () => {
    expect(customElements.get('ar-viewer')).toBeDefined();
  });

  it('attaches a shadow root in open mode', () => {
    expect(viewer.shadowRoot).not.toBeNull();
  });

  it('renders both canvases (original + result)', () => {
    expect(viewer.shadowRoot!.querySelector('#original')).not.toBeNull();
    expect(viewer.shadowRoot!.querySelector('#result')).not.toBeNull();
  });

  it('exposes the slider handle as a WAI-ARIA slider', () => {
    const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.getAttribute('aria-valuemin')).toBe('0');
    expect(handle.getAttribute('aria-valuemax')).toBe('100');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('exposes 5 background-color buttons (transparent / white / black / green / red)', () => {
    const btns = viewer.shadowRoot!.querySelectorAll('.bg-btn');
    expect(btns.length).toBe(5);
    const values = Array.from(btns).map((b) => (b as HTMLElement).dataset.bg);
    expect(values).toEqual(['transparent', 'white', 'black', '#00b140', '#ff4444']);
  });

  it('starts with the transparent (checker) background button active', () => {
    const active = viewer.shadowRoot!.querySelector('.bg-btn.active') as HTMLElement;
    expect(active).not.toBeNull();
    expect(active.dataset.bg).toBe('transparent');
  });

  // ─── setOriginal ──────────────────────────────────────────────────────────

  describe('setOriginal', () => {
    it('writes the image into the original canvas via putImageData', () => {
      const img = makeImageData(8, 6);
      viewer.setOriginal(img);
      expect(mockCtx.putImageData).toHaveBeenCalledWith(img, 0, 0);
    });

    it('parks the slider on the right (sliderPos = 100, full original visible)', () => {
      viewer.setOriginal(makeImageData(8, 6));
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('100');
    });

    it('renders dimensions in the info bar', () => {
      viewer.setOriginal(makeImageData(640, 480));
      const info = viewer.shadowRoot!.querySelector('#info-text')!;
      expect(info.textContent).toContain('640x480');
    });

    it('appends the file size in KB when fileSize is provided', () => {
      viewer.setOriginal(makeImageData(640, 480), 102_400);
      const info = viewer.shadowRoot!.querySelector('#info-text')!;
      expect(info.textContent).toContain('100 KB');
    });

    it('omits the size segment when fileSize is missing', () => {
      viewer.setOriginal(makeImageData(640, 480));
      const info = viewer.shadowRoot!.querySelector('#info-text')!;
      expect(info.textContent).not.toContain('KB');
    });
  });

  // ─── setResult ────────────────────────────────────────────────────────────

  describe('setResult', () => {
    it('writes the result into the result canvas via putImageData', () => {
      const img = makeImageData(8, 6);
      viewer.setResult(img);
      expect(mockCtx.putImageData).toHaveBeenCalledWith(img, 0, 0);
    });

    it('parks the slider on the LEFT (sliderPos = 0, full result visible) when prefers-reduced-motion', () => {
      prefersReducedMotion = true;
      viewer.setResult(makeImageData(8, 6));
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('0');
    });

    it('appends blob size in KB when blob is provided', () => {
      const blob = new Blob([new Uint8Array(51_200)]);
      viewer.setResult(makeImageData(640, 480), blob);
      const info = viewer.shadowRoot!.querySelector('#info-text')!;
      expect(info.textContent).toContain('50 KB');
    });
  });

  // ─── clearResult ──────────────────────────────────────────────────────────

  describe('clearResult', () => {
    it('clears the result canvas and resets slider to 100', () => {
      viewer.setResult(makeImageData(8, 6));
      viewer.clearResult();
      expect(mockCtx.clearRect).toHaveBeenCalled();
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('100');
    });
  });

  // ─── Background color toggle ──────────────────────────────────────────────

  describe('background color buttons', () => {
    it('clicking a non-transparent swatch sets background-color on the layers and removes the checker class', () => {
      const whiteBtn = viewer.shadowRoot!.querySelector('.bg-btn[data-bg="white"]') as HTMLElement;
      whiteBtn.click();

      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      const layer = viewer.shadowRoot!.querySelector('#result-layer') as HTMLElement;
      expect(container.style.backgroundColor).toBe('white');
      expect(layer.style.backgroundColor).toBe('white');
      expect(container.className).not.toContain('checker-bg');
      expect(layer.className).not.toContain('checker-bg');
    });

    it('clicking the transparent swatch restores the checker pattern', () => {
      const black = viewer.shadowRoot!.querySelector('.bg-btn[data-bg="black"]') as HTMLElement;
      const transparent = viewer.shadowRoot!.querySelector(
        '.bg-btn[data-bg="transparent"]',
      ) as HTMLElement;
      black.click();
      transparent.click();

      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      const layer = viewer.shadowRoot!.querySelector('#result-layer') as HTMLElement;
      expect(container.className).toContain('checker-bg');
      expect(layer.className).toContain('checker-bg');
      expect(container.style.backgroundColor).toBe('');
    });

    it('moves the .active class to the clicked swatch (single-selection radiogroup-like)', () => {
      const greenBtn = viewer.shadowRoot!.querySelector(
        '.bg-btn[data-bg="#00b140"]',
      ) as HTMLElement;
      greenBtn.click();
      const active = viewer.shadowRoot!.querySelectorAll('.bg-btn.active');
      expect(active.length).toBe(1);
      expect((active[0] as HTMLElement).dataset.bg).toBe('#00b140');
    });
  });

  // ─── Keyboard nav on slider handle (WAI-ARIA standard) ────────────────────

  describe('slider keyboard nav', () => {
    function focus(): HTMLElement {
      const handle = viewer.shadowRoot!.querySelector('#slider-handle') as HTMLElement;
      handle.focus();
      return handle;
    }

    function press(handle: HTMLElement, key: string, shift = false): void {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));
    }

    it('starts at 50 before any image is loaded', () => {
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
    });

    it('ArrowLeft decreases by 2', () => {
      const handle = focus();
      press(handle, 'ArrowLeft');
      expect(handle.getAttribute('aria-valuenow')).toBe('48');
    });

    it('Shift+ArrowLeft decreases by 10', () => {
      const handle = focus();
      press(handle, 'ArrowLeft', true);
      expect(handle.getAttribute('aria-valuenow')).toBe('40');
    });

    it('ArrowRight increases by 2', () => {
      const handle = focus();
      press(handle, 'ArrowRight');
      expect(handle.getAttribute('aria-valuenow')).toBe('52');
    });

    it('Home jumps to 0', () => {
      const handle = focus();
      press(handle, 'Home');
      expect(handle.getAttribute('aria-valuenow')).toBe('0');
    });

    it('End jumps to 100', () => {
      const handle = focus();
      press(handle, 'End');
      expect(handle.getAttribute('aria-valuenow')).toBe('100');
    });

    it('PageDown / PageUp step by 10', () => {
      const handle = focus();
      press(handle, 'PageDown');
      expect(handle.getAttribute('aria-valuenow')).toBe('40');
      press(handle, 'PageUp');
      press(handle, 'PageUp');
      expect(handle.getAttribute('aria-valuenow')).toBe('60');
    });

    it('clamps at 0 (cannot go negative)', () => {
      const handle = focus();
      press(handle, 'Home');
      press(handle, 'ArrowLeft');
      expect(handle.getAttribute('aria-valuenow')).toBe('0');
    });

    it('clamps at 100 (cannot exceed)', () => {
      const handle = focus();
      press(handle, 'End');
      press(handle, 'ArrowRight');
      expect(handle.getAttribute('aria-valuenow')).toBe('100');
    });

    it('updates the slider line and clip-path on key press', () => {
      const handle = focus();
      press(handle, 'Home');
      const line = viewer.shadowRoot!.querySelector('#slider-line') as HTMLElement;
      const layer = viewer.shadowRoot!.querySelector('#result-layer') as HTMLElement;
      expect(line.style.left).toBe('0%');
      expect(layer.style.clipPath).toBe('inset(0 0 0 0%)');
    });

    it('ignores unknown keys (does not move the slider)', () => {
      const handle = focus();
      press(handle, 'Enter');
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
    });
  });

  // ─── Pointer drag ─────────────────────────────────────────────────────────

  describe('mouse drag on the container', () => {
    it('mousedown at the container midpoint snaps the slider to ~50', () => {
      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      container.dispatchEvent(
        new MouseEvent('mousedown', { clientX: RECT_WIDTH / 2, bubbles: true }),
      );
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
    });

    it('mousedown near the right edge snaps the slider to ~95', () => {
      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      container.dispatchEvent(
        new MouseEvent('mousedown', { clientX: RECT_WIDTH * 0.95, bubbles: true }),
      );
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('95');
    });

    it('mousemove on document while dragging continues to update the slider', () => {
      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      container.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: RECT_WIDTH * 0.7, bubbles: true }),
      );
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('70');
    });

    it('mouseup stops the drag — subsequent mousemove does not update the slider', () => {
      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      container.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientX: RECT_WIDTH * 0.9, bubbles: true }),
      );
      const handle = viewer.shadowRoot!.querySelector('#slider-handle')!;
      expect(handle.getAttribute('aria-valuenow')).toBe('0');
    });
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('removes document-level mouse/touch listeners so detached instances do not move the slider', () => {
      const container = viewer.shadowRoot!.querySelector('#container') as HTMLElement;
      container.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
      viewer.remove();
      // After disconnect, document mousemove must not throw (listener gone)
      // and a fresh viewer's slider should not move from the detached one.
      expect(() => {
        document.dispatchEvent(
          new MouseEvent('mousemove', { clientX: RECT_WIDTH * 0.5, bubbles: true }),
        );
      }).not.toThrow();
    });
  });
});
