import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Behavioural tests for the <ar-app> orchestrator (#131).
 *
 * Strategy: ar-app is the wiring layer — it does not own the ML pipeline
 * itself, just the orchestration of dropzone → progress → viewer →
 * download. We mock PipelineOrchestrator and sw-register so the real
 * worker imports never run, then assert on observable shadow-DOM state,
 * dispatched events, and lifecycle hooks.
 *
 * Out of scope here (covered by integration / e2e):
 *   - Real ML inference end-to-end
 *   - Worker postMessage choreography
 *   - Image decoding via createImageBitmap
 */

// ─── Module mocks (must precede component import) ─────────────────────────

// `vi.hoisted` makes these refs survive vi.mock's automatic hoisting above
// the module imports — needed so the test can reach the orchestrator mock
// to flip resolve/reject per scenario.
const { preloadModelMock } = vi.hoisted(() => ({
  preloadModelMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/pipeline/orchestrator', () => ({
  PipelineOrchestrator: class MockOrchestrator {
    preloadModel = preloadModelMock;
    process = vi.fn(() =>
      Promise.resolve({
        imageData: new ImageData(4, 4),
        watermarks: [],
        stages: [],
      }),
    );
    abort = vi.fn();
    setStageCallback = vi.fn();
  },
  PipelineAbortError: class PipelineAbortError extends Error {
    constructor(msg = 'aborted') {
      super(msg);
    }
  },
}));

vi.mock('../../src/sw-register', () => ({
  installApp: vi.fn(() => Promise.resolve(true)),
  isAppInstalled: vi.fn(() => false),
}));

vi.mock('../../src/utils/image-io', () => ({
  exportPng: vi.fn(() => Promise.resolve(new Blob([new Uint8Array(8)]))),
}));

vi.mock('../../src/utils/zip', () => ({
  createZip: vi.fn(() => Promise.resolve(new Blob([new Uint8Array(8)]))),
  safeZipEntryName: (s: string) => s,
  downloadBlob: vi.fn(),
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
  fillRect: vi.fn(),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  createPattern: vi.fn(() => 'mock-pattern'),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => new ImageData(1, 1)),
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

// ─── Imports (after stubs) ────────────────────────────────────────────────

// Register every child component ar-app's render() instantiates, so the
// querySelector('ar-dropzone'), etc. handles upgrade to real classes
// with their public methods (setEnabled / setLoadingState / setOriginal).
import '../../src/components/ar-dropzone';
import '../../src/components/ar-viewer';
import '../../src/components/ar-progress';
import '../../src/components/ar-download';
import '../../src/components/ar-editor';
import '../../src/components/ar-editor-advanced';
import '../../src/components/ar-batch-grid';
import '../../src/components/ar-batch-item';

import '../../src/components/ar-app';
import type { ArApp } from '../../src/components/ar-app';

async function flushMicrotasks(): Promise<void> {
  // Two await ticks are enough to let .then() / .catch() chains land
  await Promise.resolve();
  await Promise.resolve();
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ArApp orchestrator (#131)', () => {
  let app: ArApp;

  beforeEach(() => {
    preloadModelMock.mockClear();
    preloadModelMock.mockReturnValue(Promise.resolve());
    app = document.createElement('ar-app') as ArApp;
    document.body.appendChild(app);
  });

  afterEach(() => {
    app.remove();
  });

  // ─── Mount + structure ───────────────────────────────────────────────────

  it('registers as the <ar-app> custom element with an open shadow root', () => {
    expect(customElements.get('ar-app')).toBeDefined();
    expect(app.shadowRoot).not.toBeNull();
  });

  it('renders the hero, workspace, and the four child component slots', () => {
    const root = app.shadowRoot!;
    expect(root.querySelector('#hero')).not.toBeNull();
    expect(root.querySelector('#workspace')).not.toBeNull();
    expect(root.querySelector('ar-dropzone')).not.toBeNull();
    expect(root.querySelector('ar-viewer')).not.toBeNull();
    expect(root.querySelector('ar-progress')).not.toBeNull();
    expect(root.querySelector('ar-download')).not.toBeNull();
  });

  it('renders the command bar with state, filename, meta — no in-bar cancel button', () => {
    const root = app.shadowRoot!;
    expect(root.querySelector('#command-bar')).not.toBeNull();
    expect(root.querySelector('#cmd-filename')).not.toBeNull();
    expect(root.querySelector('#cmd-meta')).not.toBeNull();
    expect(root.querySelector('#cmd-state')).not.toBeNull();
    // The cmdbar Cancel button was removed — its abort path was confusing
    // in practice (workers stopped but state surfaces did not always
    // settle predictably). The orchestrator's AbortController is still
    // alive for "drop a new image mid-process" / batch teardown flows.
    expect(root.querySelector('#cmd-cancel')).toBeNull();
  });

  it('does NOT render the legacy #cmd-new-image button (#151 removed it)', () => {
    // Migrated from tests/components/ar-command-bar.test.ts (#135).
    expect(app.shadowRoot!.querySelector('#cmd-new-image')).toBeNull();
  });

  it('the command bar sits inside the workspace and AFTER <ar-viewer> in the DOM order', () => {
    // Originally migrated from ar-command-bar.test.ts (#135) asserting
    // BEFORE; flipped to AFTER as part of the cancel-feedback work —
    // user did not want "$ nukea file.png · ... · ready" appearing
    // ABOVE the image when processing finished or was cancelled. The
    // bar still owns the same status role / aria-live region; only
    // the DOM position changed.
    const ws = app.shadowRoot!.querySelector('#single-file-workspace')!;
    const cmdBar = ws.querySelector('#command-bar')!;
    const viewer = ws.querySelector('ar-viewer')!;
    // compareDocumentPosition: 2 = preceding → cmdBar comes AFTER viewer
    expect(cmdBar.compareDocumentPosition(viewer) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('renders the status line with reactor + model state slots', () => {
    const root = app.shadowRoot!;
    const reactor = root.querySelector('#status-reactor') as HTMLElement;
    const model = root.querySelector('#status-model') as HTMLElement;
    expect(reactor).not.toBeNull();
    expect(model).not.toBeNull();
  });

  it('renders the marquee bleed banner with runtime placeholder', () => {
    const marquee = app.shadowRoot!.querySelector('#precision-marquee-bleed');
    expect(marquee).not.toBeNull();
    expect(marquee!.querySelectorAll('[data-marquee-runtime]').length).toBeGreaterThan(0);
  });

  it('renders the install button hidden until a PWA install signal arrives', () => {
    const btn = app.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // Default: not yet `.visible`. Mobile heuristic gates it on a 2-second
    // timer + matchMedia, neither of which has fired in unit-test land.
    expect(btn.classList.contains('visible')).toBe(false);
  });

  // ─── Initial reactor state ───────────────────────────────────────────────

  describe('initial status line', () => {
    // Use a never-resolving preload so the reactor/model don't flip to
    // their post-load state before the assertions run. The default
    // preloadModelMock above resolves immediately, which is right for
    // the "on resolve" test but races these two.
    function freshAppWithPendingPreload(): ArApp {
      preloadModelMock.mockReturnValueOnce(new Promise(() => {}));
      const inst = document.createElement('ar-app') as ArApp;
      document.body.appendChild(inst);
      return inst;
    }

    it('reactor starts in the offline state', () => {
      const fresh = freshAppWithPendingPreload();
      const reactor = fresh.shadowRoot!.querySelector('#status-reactor') as HTMLElement;
      expect(reactor.dataset.state).toBe('offline');
      fresh.remove();
    });

    it('model starts in the loading state', () => {
      const fresh = freshAppWithPendingPreload();
      const model = fresh.shadowRoot!.querySelector('#status-model') as HTMLElement;
      expect(model.dataset.state).toBe('loading');
      fresh.remove();
    });
  });

  // ─── Preload pipeline ────────────────────────────────────────────────────

  describe('preloadModel flow', () => {
    it('constructs a PipelineOrchestrator and calls preloadModel on connect', () => {
      expect(preloadModelMock).toHaveBeenCalledWith('briaai/RMBG-1.4');
    });

    it('on resolve, flips reactor → online and model → ready', async () => {
      preloadModelMock.mockReturnValueOnce(Promise.resolve());
      const fresh = document.createElement('ar-app') as ArApp;
      document.body.appendChild(fresh);
      await flushMicrotasks();

      const reactor = fresh.shadowRoot!.querySelector('#status-reactor') as HTMLElement;
      const model = fresh.shadowRoot!.querySelector('#status-model') as HTMLElement;
      expect(reactor.dataset.state).toBe('online');
      expect(model.dataset.state).toBe('ready');
      fresh.remove();
    });

    it('on reject, keeps reactor offline and sets model → lazy', async () => {
      preloadModelMock.mockReturnValueOnce(Promise.reject(new Error('network down')));
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});

      const fresh = document.createElement('ar-app') as ArApp;
      document.body.appendChild(fresh);
      await flushMicrotasks();

      const reactor = fresh.shadowRoot!.querySelector('#status-reactor') as HTMLElement;
      const model = fresh.shadowRoot!.querySelector('#status-model') as HTMLElement;
      expect(reactor.dataset.state).toBe('offline');
      expect(model.dataset.state).toBe('lazy');
      fresh.remove();
    });
  });

  // ─── Error modal ─────────────────────────────────────────────────────────

  describe('error modal', () => {
    it('renders hidden by default', () => {
      const modal = app.shadowRoot!.querySelector('#error-modal') as HTMLElement;
      expect(modal).not.toBeNull();
      expect(modal.hasAttribute('hidden')).toBe(true);
    });

    it('exposes retry and dismiss buttons + backdrop', () => {
      const root = app.shadowRoot!;
      expect(root.querySelector('#error-modal-retry')).not.toBeNull();
      expect(root.querySelector('#error-modal-dismiss')).not.toBeNull();
      expect(root.querySelector('#error-modal-backdrop')).not.toBeNull();
    });
  });

  // ─── PWA install ─────────────────────────────────────────────────────────

  describe('PWA install button', () => {
    it('reveals the install button when nukebg:pwa-installable fires', async () => {
      const btn = app.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
      expect(btn.classList.contains('visible')).toBe(false);
      document.dispatchEvent(new CustomEvent('nukebg:pwa-installable'));
      expect(btn.classList.contains('visible')).toBe(true);
      expect(btn.disabled).toBe(false);
    });
  });

  // ─── Locale propagation ─────────────────────────────────────────────────

  describe('locale change', () => {
    it('re-rendering text on nukebg:locale-changed does not throw', () => {
      expect(() => {
        document.dispatchEvent(new CustomEvent('nukebg:locale-changed'));
      }).not.toThrow();
    });
  });

  // ─── Image-loaded handoff ────────────────────────────────────────────────

  describe('ar:image-loaded handoff', () => {
    it('an image-loaded event from inside the shadow tree updates the command-bar filename', async () => {
      const dropzone = app.shadowRoot!.querySelector('ar-dropzone')!;
      dropzone.dispatchEvent(
        new CustomEvent('ar:image-loaded', {
          bubbles: true,
          composed: true,
          detail: {
            file: new File([new Uint8Array(8)], 'flamingo.png', { type: 'image/png' }),
            imageData: new ImageData(4, 4),
            originalImageData: new ImageData(4, 4),
            originalWidth: 4,
            originalHeight: 4,
            wasDownsampled: false,
          },
        }),
      );
      // Let the async handler land enough to update the filename
      await flushMicrotasks();
      const filename = app.shadowRoot!.querySelector('#cmd-filename')!;
      expect(filename.textContent).toBe('flamingo.png');
    });
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('removes the locale + pwa-installable document listeners', () => {
      const fresh = document.createElement('ar-app') as ArApp;
      document.body.appendChild(fresh);
      // Trigger to confirm listeners exist
      const btn = fresh.shadowRoot!.querySelector('#install-btn') as HTMLButtonElement;
      document.dispatchEvent(new CustomEvent('nukebg:pwa-installable'));
      expect(btn.classList.contains('visible')).toBe(true);

      fresh.remove();
      // After remove, dispatching again must NOT throw and must NOT
      // mutate the (detached) install button.
      btn.classList.remove('visible');
      expect(() => {
        document.dispatchEvent(new CustomEvent('nukebg:pwa-installable'));
      }).not.toThrow();
      expect(btn.classList.contains('visible')).toBe(false);
    });
  });
});
