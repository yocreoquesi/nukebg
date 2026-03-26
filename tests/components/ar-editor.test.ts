import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests del componente ar-editor (Web Component).
 *
 * Usa happy-dom (configurado en vite.config.ts) para simular el DOM.
 * happy-dom no soporta canvas 2D context completamente, asi que
 * parcheamos getContext para devolver un mock que no crashee.
 *
 * Testea: setImage, getResultImageData, undo/redo, reset, toolbar, eventos.
 */

// Polyfill de ImageData para happy-dom
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, maybeHeight?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? (dataOrWidth.length / (widthOrHeight * 4));
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

// Mock de CanvasRenderingContext2D para happy-dom
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

// Parche global: canvas.getContext('2d') devuelve mock
const origCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
  const el = origCreateElement(tag, options);
  if (tag === 'canvas') {
    (el as any).getContext = vi.fn(() => mockCtx);
    mockCtx.canvas = el as HTMLCanvasElement;
  }
  return el;
});

// Tambien patchear OffscreenCanvas (usado en redraw)
vi.stubGlobal('OffscreenCanvas', class {
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext() { return mockCtx; }
});

// Registrar el componente
import '../../src/components/ar-editor';
import { ArEditor } from '../../src/components/ar-editor';

/** Crea un ImageData sintetico */
function makeTestImageData(width = 4, height = 4): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 100;
    data[i * 4 + 1] = 150;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('ArEditor component', () => {
  let editor: ArEditor;

  beforeEach(() => {
    editor = document.createElement('ar-editor') as ArEditor;
    document.body.appendChild(editor);
  });

  it('se registra como custom element', () => {
    expect(customElements.get('ar-editor')).toBeDefined();
  });

  it('tiene shadow DOM', () => {
    expect(editor.shadowRoot).not.toBeNull();
  });

  it('contiene un canvas en el shadow DOM', () => {
    const canvas = editor.shadowRoot!.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('contiene botones de undo/redo', () => {
    const undo = editor.shadowRoot!.querySelector('#undo-btn');
    const redo = editor.shadowRoot!.querySelector('#redo-btn');
    expect(undo).not.toBeNull();
    expect(redo).not.toBeNull();
  });

  describe('setImage', () => {
    it('establece la imagen y se puede recuperar con getResultImageData', () => {
      const img = makeTestImageData();
      editor.setImage(img);

      const result = editor.getResultImageData();
      expect(result).not.toBeNull();
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
    });

    it('crea una copia independiente de los datos', () => {
      const img = makeTestImageData();
      editor.setImage(img);

      // Modificar el original
      img.data[0] = 0;

      // El editor tiene su propia copia
      const result = editor.getResultImageData();
      expect(result.data[0]).toBe(100);
    });

    it('preserva los valores RGB y alpha de la imagen', () => {
      const img = makeTestImageData(2, 2);
      img.data[0] = 10;
      img.data[1] = 20;
      img.data[2] = 30;
      img.data[3] = 128;

      editor.setImage(img);

      const result = editor.getResultImageData();
      expect(result.data[0]).toBe(10);
      expect(result.data[1]).toBe(20);
      expect(result.data[2]).toBe(30);
      expect(result.data[3]).toBe(128);
    });

    it('resetea las pilas de undo/redo al cargar nueva imagen', () => {
      editor.setImage(makeTestImageData());

      const undoBtn = editor.shadowRoot!.querySelector('#undo-btn') as HTMLButtonElement;
      const redoBtn = editor.shadowRoot!.querySelector('#redo-btn') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(true);
      expect(redoBtn.disabled).toBe(true);
    });
  });

  describe('getResultImageData', () => {
    it('devuelve el ImageData actual del editor', () => {
      const img = makeTestImageData(8, 8);
      editor.setImage(img);

      const result = editor.getResultImageData();
      expect(result).toBeInstanceOf(ImageData);
      expect(result.data.length).toBe(8 * 8 * 4);
    });
  });

  describe('reset', () => {
    it('limpia el estado interno', () => {
      editor.setImage(makeTestImageData());
      editor.reset();

      const result = editor.getResultImageData();
      expect(result).toBeNull();
    });
  });

  describe('undo/redo', () => {
    it('undo esta deshabilitado antes de editar', () => {
      editor.setImage(makeTestImageData(4, 4));
      const undoBtn = editor.shadowRoot!.querySelector('#undo-btn') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(true);
    });

    it('redo esta deshabilitado antes de editar', () => {
      editor.setImage(makeTestImageData(4, 4));
      const redoBtn = editor.shadowRoot!.querySelector('#redo-btn') as HTMLButtonElement;
      expect(redoBtn.disabled).toBe(true);
    });
  });

  describe('eventos', () => {
    it('emite ar:editor-done con imageData al hacer click en Done', async () => {
      editor.setImage(makeTestImageData(4, 4));

      const donePromise = new Promise<CustomEvent>((resolve) => {
        editor.addEventListener('ar:editor-done', (e) => resolve(e as CustomEvent), { once: true });
      });

      const doneBtn = editor.shadowRoot!.querySelector('#done-btn') as HTMLButtonElement;
      doneBtn.click();

      const event = await donePromise;
      expect(event.detail.imageData).toBeInstanceOf(ImageData);
    });

    it('emite ar:editor-cancel al hacer click en Cancel', async () => {
      editor.setImage(makeTestImageData());

      const cancelPromise = new Promise<Event>((resolve) => {
        editor.addEventListener('ar:editor-cancel', (e) => resolve(e), { once: true });
      });

      const cancelBtn = editor.shadowRoot!.querySelector('#cancel-btn') as HTMLButtonElement;
      cancelBtn.click();

      const event = await cancelPromise;
      expect(event).toBeTruthy();
    });
  });

  describe('toolbar', () => {
    it('tiene selector de forma del brush', () => {
      const select = editor.shadowRoot!.querySelector('#brush-shape') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.value).toBe('circle');
    });

    it('tiene slider de tamano del brush', () => {
      const slider = editor.shadowRoot!.querySelector('#brush-size') as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.type).toBe('range');
      expect(slider.value).toBe('20');
    });

    it('tiene botones de zoom', () => {
      expect(editor.shadowRoot!.querySelector('#zoom-in')).not.toBeNull();
      expect(editor.shadowRoot!.querySelector('#zoom-out')).not.toBeNull();
      expect(editor.shadowRoot!.querySelector('#zoom-fit')).not.toBeNull();
    });

    it('tiene boton de ayuda con tooltip', () => {
      const helpBtn = editor.shadowRoot!.querySelector('#help-btn');
      const tooltip = editor.shadowRoot!.querySelector('#help-tooltip');
      expect(helpBtn).not.toBeNull();
      expect(tooltip).not.toBeNull();
    });

    it('toggle del tooltip de ayuda', () => {
      const helpBtn = editor.shadowRoot!.querySelector('#help-btn') as HTMLButtonElement;
      const tooltip = editor.shadowRoot!.querySelector('#help-tooltip') as HTMLElement;

      expect(tooltip.classList.contains('visible')).toBe(false);

      helpBtn.click();
      expect(tooltip.classList.contains('visible')).toBe(true);

      helpBtn.click();
      expect(tooltip.classList.contains('visible')).toBe(false);
    });

    it('tiene 5 opciones de fondo', () => {
      const bgBtns = editor.shadowRoot!.querySelectorAll('.bg-btn');
      expect(bgBtns.length).toBe(5);
    });
  });
});
