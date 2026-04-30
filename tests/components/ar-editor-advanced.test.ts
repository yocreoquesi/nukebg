import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Behavioural tests for the <ar-editor-advanced> component (#131).
 *
 * Strategy: this is the gnarliest editor in the app — lasso + SAM +
 * RMBG re-segment + PatchMatch + undo/redo + multi-tool. We mock every
 * heavy dependency (RMBG loader, MobileSAM, PatchMatch, ROI processor)
 * so the test exercises the wiring layer (toolbar, events, public API)
 * without firing real ML or CV. Drag-and-paint pixel pipelines belong
 * to the e2e + integration suites, not here.
 */

// ─── Module mocks (must precede component import) ─────────────────────────

vi.mock('../../src/refine/loaders/rmbg14', () => ({
  createRmbg14Loader: vi.fn(() => ({
    label: 'mock',
    approxDownloadMb: 0,
    warmup: vi.fn(() => Promise.resolve()),
    segment: vi.fn(() => Promise.resolve({ alpha: new Uint8Array(16), width: 4, height: 4, latencyMs: 1, backend: 'wasm' })),
    dispose: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../../src/refine/loaders/mobile-sam', () => ({
  loadSam: vi.fn(() => Promise.resolve()),
  encodeSam: vi.fn(() => Promise.resolve()),
  decodeSam: vi.fn(() => Promise.resolve(new Uint8Array(16))),
  disposeSam: vi.fn(),
  onSamProgress: vi.fn(() => () => {}),
}));

vi.mock('../../src/refine/roi-process', () => ({
  processRoi: vi.fn(() => Promise.resolve(new Uint8Array(16))),
  rasterizePolygon: vi.fn(() => new Uint8Array(16)),
}));

vi.mock('../../src/workers/cv/patchmatch-inpaint', () => ({
  patchMatchInpaint: vi.fn(() => new Uint8ClampedArray(64)),
}));

vi.mock('../../src/pipeline/finalize', () => ({
  refineEdges: vi.fn((alpha: Uint8Array) => alpha),
  dropOrphanBlobs: vi.fn((alpha: Uint8Array) => alpha),
  fillSubjectHoles: vi.fn((alpha: Uint8Array) => alpha),
  promoteSpeckleAlpha: vi.fn((alpha: Uint8Array) => alpha),
}));

// ─── Test infra ──────────────────────────────────────────────────────────

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
  strokeStyle: '',
  lineWidth: 0,
  globalCompositeOperation: 'source-over',
  globalAlpha: 1,
  setLineDash: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  createPattern: vi.fn(() => 'mock-pattern'),
  getImageData: vi.fn(() => new ImageData(1, 1)),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  canvas: {} as HTMLCanvasElement,
};
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => mockCtx,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

vi.stubGlobal(
  'OffscreenCanvas',
  class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return mockCtx;
    }
  },
);

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// ─── Component import ────────────────────────────────────────────────────

import '../../src/components/ar-editor-advanced';
import type { ArEditorAdvanced } from '../../src/components/ar-editor-advanced';

function makeImageData(w = 8, h = 8): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 100;
    data[i * 4 + 1] = 150;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ArEditorAdvanced component (#131)', () => {
  let editor: ArEditorAdvanced;

  beforeEach(() => {
    editor = document.createElement('ar-editor-advanced') as ArEditorAdvanced;
    document.body.appendChild(editor);
  });

  afterEach(() => {
    editor.remove();
  });

  // ─── Mount + structure ───────────────────────────────────────────────────

  it('registers as the <ar-editor-advanced> custom element', () => {
    expect(customElements.get('ar-editor-advanced')).toBeDefined();
  });

  it('attaches an open shadow root', () => {
    expect(editor.shadowRoot).not.toBeNull();
  });

  it('renders the three tool buttons (brush / eraser / lasso) with eraser pre-selected', () => {
    const root = editor.shadowRoot!;
    const brush = root.querySelector('#tool-brush') as HTMLButtonElement;
    const eraser = root.querySelector('#tool-eraser') as HTMLButtonElement;
    const lasso = root.querySelector('#tool-lasso') as HTMLButtonElement;
    expect(brush).not.toBeNull();
    expect(eraser).not.toBeNull();
    expect(lasso).not.toBeNull();
    expect(eraser.classList.contains('active')).toBe(true);
    expect(brush.classList.contains('active')).toBe(false);
    expect(lasso.classList.contains('active')).toBe(false);
  });

  it('renders the brush-size range slider with 4..120 bounds and a live value display', () => {
    const slider = editor.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
    const valDisplay = editor.shadowRoot!.querySelector('#brush-size-val')!;
    expect(slider).not.toBeNull();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('4');
    expect(slider.max).toBe('120');
    expect(slider.value).toBe('24');
    expect(valDisplay.textContent).toBe('24');
  });

  it('renders the zoom controls (in / out / fit) and the percentage display', () => {
    const root = editor.shadowRoot!;
    expect(root.querySelector('#zoom-in')).not.toBeNull();
    expect(root.querySelector('#zoom-out')).not.toBeNull();
    expect(root.querySelector('#zoom-fit')).not.toBeNull();
    expect(root.querySelector('#zoom-display')!.textContent).toBe('100%');
  });

  it('renders the four lasso actions (crop / refine / erase-object / remove-watermark)', () => {
    const root = editor.shadowRoot!;
    expect(root.querySelector('#action-crop')).not.toBeNull();
    expect(root.querySelector('#action-refine')).not.toBeNull();
    expect(root.querySelector('#action-erase-object')).not.toBeNull();
    expect(root.querySelector('#action-remove-watermark')).not.toBeNull();
  });

  it('renders the preview confirm row and the preview diff badge', () => {
    const root = editor.shadowRoot!;
    expect(root.querySelector('#preview-actions')).not.toBeNull();
    expect(root.querySelector('#action-apply-preview')).not.toBeNull();
    expect(root.querySelector('#action-cancel-preview')).not.toBeNull();
    expect(root.querySelector('#preview-diff')).not.toBeNull();
  });

  it('renders the footer with undo / redo / cancel / done buttons', () => {
    const root = editor.shadowRoot!;
    expect(root.querySelector('#undo')).not.toBeNull();
    expect(root.querySelector('#redo')).not.toBeNull();
    expect(root.querySelector('#cancel')).not.toBeNull();
    expect(root.querySelector('#done')).not.toBeNull();
  });

  it('renders the reprocess + restore-original action buttons in the toolbar', () => {
    const root = editor.shadowRoot!;
    expect(root.querySelector('#reprocess')).not.toBeNull();
    expect(root.querySelector('#restore-original')).not.toBeNull();
  });

  it('exposes the canvas as focusable + aria-described (a11y)', () => {
    // Migrated from tests/components/a11y-canvas-slider.test.ts (#135).
    const canvas = editor.shadowRoot!.querySelector('canvas')!;
    expect(canvas.getAttribute('tabindex')).toBe('0');
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders the help toggle + help panel; panel hidden initially', () => {
    const root = editor.shadowRoot!;
    const toggle = root.querySelector('#help-toggle') as HTMLButtonElement;
    const panel = root.querySelector('#help-panel')!;
    expect(toggle).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // ─── Initial state ───────────────────────────────────────────────────────

  describe('initial undo/redo state', () => {
    it('undo button is disabled before any edit', () => {
      const undo = editor.shadowRoot!.querySelector('#undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
    });

    it('redo button is disabled before any edit', () => {
      const redo = editor.shadowRoot!.querySelector('#redo') as HTMLButtonElement;
      expect(redo.disabled).toBe(true);
    });
  });

  // ─── setImage public API ─────────────────────────────────────────────────

  describe('setImage', () => {
    it('accepts current + original ImageData without throwing', () => {
      expect(() => {
        editor.setImage(makeImageData(8, 8), makeImageData(8, 8));
      }).not.toThrow();
    });

    it('keeps undo/redo disabled immediately after setImage (history reset)', () => {
      editor.setImage(makeImageData(8, 8), makeImageData(8, 8));
      const undo = editor.shadowRoot!.querySelector('#undo') as HTMLButtonElement;
      const redo = editor.shadowRoot!.querySelector('#redo') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);
    });

    it('setting a new image after editing resets the undo/redo state', () => {
      editor.setImage(makeImageData(8, 8), makeImageData(8, 8));
      editor.setImage(makeImageData(16, 16), makeImageData(16, 16));
      const undo = editor.shadowRoot!.querySelector('#undo') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
    });
  });

  // ─── Tool selection ──────────────────────────────────────────────────────

  describe('tool selection', () => {
    function getActiveTool(): string | null {
      const root = editor.shadowRoot!;
      const active = root.querySelector('.tool-btn.active') as HTMLButtonElement | null;
      return active?.id ?? null;
    }

    it('clicking #tool-brush moves the active class onto brush', () => {
      const brush = editor.shadowRoot!.querySelector('#tool-brush') as HTMLButtonElement;
      brush.click();
      expect(getActiveTool()).toBe('tool-brush');
    });

    it('clicking #tool-lasso moves the active class onto lasso (single-selection toolbar)', () => {
      const lasso = editor.shadowRoot!.querySelector('#tool-lasso') as HTMLButtonElement;
      lasso.click();
      expect(getActiveTool()).toBe('tool-lasso');
    });

    it('clicking #tool-eraser restores eraser as the active tool', () => {
      const brush = editor.shadowRoot!.querySelector('#tool-brush') as HTMLButtonElement;
      const eraser = editor.shadowRoot!.querySelector('#tool-eraser') as HTMLButtonElement;
      brush.click();
      eraser.click();
      expect(getActiveTool()).toBe('tool-eraser');
    });
  });

  // ─── Brush size slider ───────────────────────────────────────────────────

  describe('brush-size slider', () => {
    it('updates the value display when the slider input fires', () => {
      const slider = editor.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
      const display = editor.shadowRoot!.querySelector('#brush-size-val')!;
      slider.value = '60';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(display.textContent).toBe('60');
    });

    it('handles min and max boundary values', () => {
      const slider = editor.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
      const display = editor.shadowRoot!.querySelector('#brush-size-val')!;
      slider.value = '4';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(display.textContent).toBe('4');
      slider.value = '120';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(display.textContent).toBe('120');
    });
  });

  // ─── Help toggle ─────────────────────────────────────────────────────────

  describe('help toggle', () => {
    it('clicking #help-toggle reveals the help panel and flips aria-expanded', () => {
      const toggle = editor.shadowRoot!.querySelector('#help-toggle') as HTMLButtonElement;
      const panel = editor.shadowRoot!.querySelector('#help-panel')!;
      toggle.click();
      expect(panel.classList.contains('hidden')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('clicking #help-toggle a second time hides the help panel again', () => {
      const toggle = editor.shadowRoot!.querySelector('#help-toggle') as HTMLButtonElement;
      const panel = editor.shadowRoot!.querySelector('#help-panel')!;
      toggle.click();
      toggle.click();
      expect(panel.classList.contains('hidden')).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });
  });

  // ─── Cancel + Done events ────────────────────────────────────────────────

  describe('footer events', () => {
    it('clicking #cancel dispatches ar:advanced-cancel (bubbles, composed)', () => {
      let captured: Event | undefined;
      editor.addEventListener('ar:advanced-cancel', (e) => (captured = e));
      const cancel = editor.shadowRoot!.querySelector('#cancel') as HTMLButtonElement;
      cancel.click();
      expect(captured).toBeDefined();
      expect(captured!.bubbles).toBe(true);
      expect(captured!.composed).toBe(true);
    });

    it('clicking #done with an image loaded dispatches ar:advanced-done with imageData', () => {
      editor.setImage(makeImageData(8, 8), makeImageData(8, 8));
      let captured: CustomEvent | undefined;
      editor.addEventListener('ar:advanced-done', (e) => (captured = e as CustomEvent));
      const done = editor.shadowRoot!.querySelector('#done') as HTMLButtonElement;
      done.click();
      expect(captured).toBeDefined();
      expect(captured!.detail).toBeDefined();
      expect(captured!.bubbles).toBe(true);
      expect(captured!.composed).toBe(true);
    });
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('disposes SAM state so detached editors do not retain encoder buffers', async () => {
      const samMod = await import('../../src/refine/loaders/mobile-sam');
      const disposeMock = vi.mocked(samMod.disposeSam);
      disposeMock.mockClear();
      editor.remove();
      expect(disposeMock).toHaveBeenCalled();
    });
  });
});
