import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Behavioural tests for the <ar-dropzone> component (#131).
 *
 * Exercises: setEnabled / setLoadingState public APIs, the file-picker
 * click pathway, drag/drop visual state, paste-from-clipboard pathway,
 * single-file vs batch dispatch, format/limit error UX, and listener
 * cleanup on disconnect.
 *
 * `loadImage` is mocked at module level so the test never has to drive
 * the canvas/ImageBitmap pipeline that happy-dom only half-implements.
 */

// ─── Module mocks (must be hoisted before component import) ─────────────────

vi.mock('../../src/utils/image-io', () => {
  const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
  return {
    isSupportedFormat: (type: string) => SUPPORTED.has(type),
    loadImage: vi.fn(async (file: File) => ({
      imageData: new ImageData(4, 4),
      originalImageData: new ImageData(8, 8),
      originalWidth: 8,
      originalHeight: 8,
      wasDownsampled: true,
      format: file.type,
    })),
  };
});

// ─── Test infra ─────────────────────────────────────────────────────────────

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

// ─── Component import ──────────────────────────────────────────────────────

import '../../src/components/ar-dropzone';
import type { ArDropzone } from '../../src/components/ar-dropzone';
import * as imageIo from '../../src/utils/image-io';

const loadImageMock = vi.mocked(imageIo.loadImage);

function makePngFile(name = 'sample.png', size = 1024): File {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: 'image/png' });
}

function makeBadFile(name = 'doc.pdf'): File {
  return new File([new Uint8Array(8)], name, { type: 'application/pdf' });
}

function makeFileList(files: File[]): FileList {
  // happy-dom's FileList requires a real DataTransfer
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt.files;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ArDropzone component (#131)', () => {
  let dropzone: ArDropzone;

  beforeEach(() => {
    loadImageMock.mockClear();
    dropzone = document.createElement('ar-dropzone') as ArDropzone;
    document.body.appendChild(dropzone);
  });

  afterEach(() => {
    dropzone.remove();
  });

  // ─── Mount + structure ─────────────────────────────────────────────────────

  it('registers as the <ar-dropzone> custom element', () => {
    expect(customElements.get('ar-dropzone')).toBeDefined();
  });

  it('renders the dropzone region with role="button" and aria-label', () => {
    const dz = dropzone.shadowRoot!.querySelector('.dropzone')!;
    expect(dz.getAttribute('role')).toBe('button');
    expect(dz.getAttribute('aria-label')).toBeTruthy();
    expect(dz.getAttribute('tabindex')).toBe('0');
  });

  it('renders a hidden file input that accepts the three supported formats and is multi-select', () => {
    const input = dropzone.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
    expect(input.multiple).toBe(true);
  });

  it('renders the model-loading slot hidden by default', () => {
    const slot = dropzone.shadowRoot!.getElementById('dz-loading')!;
    expect(slot.hidden).toBe(true);
  });

  // ─── setEnabled ────────────────────────────────────────────────────────────

  describe('setEnabled', () => {
    it('toggles the dropzone-disabled class so the box stops accepting interaction', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone')!;
      dropzone.setEnabled(false);
      expect(dz.classList.contains('dropzone-disabled')).toBe(true);
      dropzone.setEnabled(true);
      expect(dz.classList.contains('dropzone-disabled')).toBe(false);
    });
  });

  // ─── setLoadingState ──────────────────────────────────────────────────────

  describe('setLoadingState', () => {
    it('reveals the slot when visible:true and adds is-loading on the dropArea', () => {
      const slot = dropzone.shadowRoot!.getElementById('dz-loading')!;
      const dz = dropzone.shadowRoot!.querySelector('.dropzone')!;
      dropzone.setLoadingState({ visible: true });
      expect(slot.hidden).toBe(false);
      expect(dz.classList.contains('is-loading')).toBe(true);
    });

    it('updates the bar width when pct is provided (clamped to 0..100)', () => {
      const bar = dropzone.shadowRoot!.getElementById('dz-loading-bar') as HTMLElement;
      dropzone.setLoadingState({ visible: true, pct: 42 });
      expect(bar.style.width).toBe('42%');
      dropzone.setLoadingState({ visible: true, pct: 250 });
      expect(bar.style.width).toBe('100%');
      dropzone.setLoadingState({ visible: true, pct: -10 });
      expect(bar.style.width).toBe('0%');
    });

    it('updates the label when label is provided', () => {
      const label = dropzone.shadowRoot!.getElementById('dz-loading-label')!;
      dropzone.setLoadingState({ visible: true, label: 'fetching weights 60%' });
      expect(label.textContent).toBe('fetching weights 60%');
    });

    it('hides immediately when visible:false and ready:false (error path)', () => {
      const slot = dropzone.shadowRoot!.getElementById('dz-loading')!;
      dropzone.setLoadingState({ visible: true });
      dropzone.setLoadingState({ visible: false });
      expect(slot.hidden).toBe(true);
    });

    it('on ready=true keeps the slot visible briefly while filling the bar to 100%', () => {
      vi.useFakeTimers();
      const slot = dropzone.shadowRoot!.getElementById('dz-loading')!;
      const bar = dropzone.shadowRoot!.getElementById('dz-loading-bar') as HTMLElement;
      dropzone.setLoadingState({ visible: true, pct: 80 });
      dropzone.setLoadingState({ visible: false, ready: true });
      // Bar should snap to 100% immediately
      expect(bar.style.width).toBe('100%');
      // But the slot should NOT be hidden yet
      expect(slot.hidden).toBe(false);
      vi.advanceTimersByTime(700);
      expect(slot.hidden).toBe(true);
      vi.useRealTimers();
    });
  });

  // ─── Click / keyboard → file picker ────────────────────────────────────────

  describe('open file picker', () => {
    it('clicking the dropArea calls fileInput.click()', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const input = dropzone.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
      const spy = vi.spyOn(input, 'click').mockImplementation(() => {});
      dz.click();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Enter key on the dropArea calls fileInput.click()', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const input = dropzone.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
      const spy = vi.spyOn(input, 'click').mockImplementation(() => {});
      dz.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Space key on the dropArea calls fileInput.click()', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const input = dropzone.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
      const spy = vi.spyOn(input, 'click').mockImplementation(() => {});
      dz.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Drag visual state ────────────────────────────────────────────────────

  describe('drag visual state', () => {
    it('dragover adds the .dragover class', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      dz.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
      expect(dz.classList.contains('dragover')).toBe(true);
    });

    it('dragleave removes the .dragover class', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      dz.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
      dz.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
      expect(dz.classList.contains('dragover')).toBe(false);
    });

    it('drop also removes the .dragover class', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      dz.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
      dz.dispatchEvent(new DragEvent('drop', { bubbles: true }));
      expect(dz.classList.contains('dragover')).toBe(false);
    });
  });

  // ─── Drop pathway ─────────────────────────────────────────────────────────

  describe('drop pathway', () => {
    it('a single valid PNG drop dispatches ar:image-loaded with the file + image data', async () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const file = makePngFile('hero.png');
      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: { files: makeFileList([file]) },
      });

      const promise = new Promise<CustomEvent>((resolve) => {
        dropzone.addEventListener('ar:image-loaded', (e) => resolve(e as CustomEvent), {
          once: true,
        });
      });
      dz.dispatchEvent(ev);
      const event = await promise;

      expect(event.detail.file).toBe(file);
      expect(event.detail.imageData).toBeInstanceOf(ImageData);
      expect(event.detail.originalWidth).toBe(8);
      expect(event.detail.originalHeight).toBe(8);
      expect(event.detail.wasDownsampled).toBe(true);
    });

    it('two valid files dispatch ar:images-loaded (plural) with the array', async () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const files = [makePngFile('a.png'), makePngFile('b.png')];
      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { files: makeFileList(files) } });

      const promise = new Promise<CustomEvent>((resolve) => {
        dropzone.addEventListener('ar:images-loaded', (e) => resolve(e as CustomEvent), {
          once: true,
        });
      });
      dz.dispatchEvent(ev);
      const event = await promise;

      expect(Array.isArray(event.detail.images)).toBe(true);
      expect(event.detail.images.length).toBe(2);
      expect(event.detail.images[0].file.name).toBe('a.png');
    });

    it('drops with no valid files surface a format error and do not dispatch', async () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const title = dropzone.shadowRoot!.querySelector('#dz-title')!;
      const original = title.textContent;

      const dispatched = vi.fn();
      dropzone.addEventListener('ar:image-loaded', dispatched);
      dropzone.addEventListener('ar:images-loaded', dispatched);

      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: { files: makeFileList([makeBadFile()]) },
      });
      dz.dispatchEvent(ev);

      // Allow the async handler to run
      await Promise.resolve();
      await Promise.resolve();

      expect(dispatched).not.toHaveBeenCalled();
      expect(dz.classList.contains('error')).toBe(true);
      expect(title.textContent).not.toBe(original);
    });

    it('drops with no dataTransfer.files do not throw and dispatch nothing', () => {
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const dispatched = vi.fn();
      dropzone.addEventListener('ar:image-loaded', dispatched);
      dropzone.addEventListener('ar:images-loaded', dispatched);

      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { files: makeFileList([]) } });
      expect(() => dz.dispatchEvent(ev)).not.toThrow();
      expect(dispatched).not.toHaveBeenCalled();
    });
  });

  // ─── File-input change pathway ────────────────────────────────────────────

  describe('file input change', () => {
    it('a single file selected via the picker dispatches ar:image-loaded', async () => {
      const input = dropzone.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makePngFile('picked.png');
      Object.defineProperty(input, 'files', { value: makeFileList([file]), configurable: true });

      const promise = new Promise<CustomEvent>((resolve) => {
        dropzone.addEventListener('ar:image-loaded', (e) => resolve(e as CustomEvent), {
          once: true,
        });
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const event = await promise;

      expect(event.detail.file).toBe(file);
    });
  });

  // ─── Paste-from-clipboard pathway ─────────────────────────────────────────

  describe('paste pathway', () => {
    it('pasting an image item dispatches ar:image-loaded', async () => {
      const file = makePngFile('clipboard.png');
      const item: DataTransferItem = {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => file,
        getAsString: vi.fn(),
        webkitGetAsEntry: vi.fn(() => null),
      } as unknown as DataTransferItem;

      const ev = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', {
        value: {
          items: [item][Symbol.iterator]
            ? [item]
            : { 0: item, length: 1, [Symbol.iterator]: () => [item][Symbol.iterator]() },
        },
      });

      const promise = new Promise<CustomEvent>((resolve) => {
        dropzone.addEventListener('ar:image-loaded', (e) => resolve(e as CustomEvent), {
          once: true,
        });
      });
      document.dispatchEvent(ev);
      const event = await promise;

      expect(event.detail.file).toBe(file);
    });

    it('paste is a no-op while the dropzone is disabled', async () => {
      dropzone.setEnabled(false);
      const dispatched = vi.fn();
      dropzone.addEventListener('ar:image-loaded', dispatched);

      const file = makePngFile();
      const item: DataTransferItem = {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => file,
      } as unknown as DataTransferItem;
      const ev = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', { value: { items: [item] } });
      document.dispatchEvent(ev);

      await Promise.resolve();
      expect(dispatched).not.toHaveBeenCalled();
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('disconnectedCallback', () => {
    it('detaches the document paste listener so removed instances do not fire', async () => {
      const dispatched = vi.fn();
      dropzone.addEventListener('ar:image-loaded', dispatched);
      dropzone.remove();

      const file = makePngFile();
      const item: DataTransferItem = {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => file,
      } as unknown as DataTransferItem;
      const ev = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', { value: { items: [item] } });
      document.dispatchEvent(ev);

      await Promise.resolve();
      expect(dispatched).not.toHaveBeenCalled();
    });
  });

  // ─── Error UX ────────────────────────────────────────────────────────────

  describe('format error UX', () => {
    it('drops the .error class onto the dropzone and clears it after the shake', () => {
      vi.useFakeTimers();
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: { files: makeFileList([makeBadFile()]) },
      });
      dz.dispatchEvent(ev);

      expect(dz.classList.contains('error')).toBe(true);
      vi.advanceTimersByTime(350);
      expect(dz.classList.contains('error')).toBe(false);
      vi.useRealTimers();
    });

    it('restores the original title text after 3 seconds', async () => {
      vi.useFakeTimers();
      const title = dropzone.shadowRoot!.querySelector('#dz-title')!;
      const original = title.textContent;
      const dz = dropzone.shadowRoot!.querySelector('.dropzone') as HTMLElement;
      const ev = new DragEvent('drop', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: { files: makeFileList([makeBadFile()]) },
      });
      dz.dispatchEvent(ev);

      // Wait for async handler to set the error message
      await vi.advanceTimersByTimeAsync(0);
      expect(title.textContent).not.toBe(original);
      vi.advanceTimersByTime(3100);
      expect(title.textContent).toBe(original);
      vi.useRealTimers();
    });
  });
});
