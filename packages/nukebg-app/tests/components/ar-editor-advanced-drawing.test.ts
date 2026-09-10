import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Characterization net for the advanced editor's drawing behaviour (#387).
 *
 * WHY THIS EXISTS
 *
 * The remaining #255 slices move the tool controllers — the first slices to
 * move stateful logic rather than text. The earlier slices (#383 CSS, #385
 * template) were provably safe because a moved string can be diffed; that
 * property does not survive into logic, so the safety has to come from tests.
 *
 * And there were none. `ar-editor-advanced.test.ts` stubs the 2D context with
 * `vi.fn()` and returns `new ImageData(1, 1)` from `getImageData`, so nothing
 * the editor draws is observable there. Its header defers pixel behaviour to
 * "the e2e + integration suites" — which do not open the editor either.
 *
 * HOW IT WORKS
 *
 * The context is already a mock, so this makes it a *recording* mock: every
 * call and every property assignment is appended to an ordered log. A stroke
 * therefore produces a deterministic trace, and the trace is the assertion.
 * That pins what the code draws without needing a real canvas, and so without
 * a new dependency (CONTRIBUTING requires an issue before adding one).
 *
 * WHAT IT DOES NOT DO
 *
 * It does not verify pixels. A trace proves the same drawing calls are made in
 * the same order with the same arguments; it cannot prove the browser paints
 * the same result. For that, an e2e driving a real canvas is the instrument —
 * tracked in #387 as a follow-up, deliberately not a prerequisite.
 *
 * READ THIS BEFORE "FIXING" A FAILURE HERE
 *
 * Every expected value below was captured from the current implementation, not
 * derived from the spec. That is the point: these tests assert "unchanged",
 * not "correct". If one fails during a refactor, the default reading is that
 * the refactor changed behaviour — update an expectation only once you can say
 * why the new trace is the intended one.
 */

// ─── Recording 2D context ─────────────────────────────────────────────────

const calls: string[] = [];

/** Proxy standing in for CanvasRenderingContext2D: records calls and sets. */
const recordingCtx = new Proxy({} as Record<string, unknown>, {
  get(_t, prop: string) {
    // Reads the component makes on the context, which must return usable
    // values rather than be recorded as calls.
    if (prop === 'canvas') return {} as HTMLCanvasElement;
    if (prop === 'getImageData') return () => new ImageData(1, 1);
    if (prop === 'createPattern') return () => 'mock-pattern';
    if (prop === 'measureText') return () => ({ width: 0 });
    return (...args: unknown[]) => {
      calls.push(`${prop}(${args.join(',')})`);
    };
  },
  set(_t, prop: string, value) {
    calls.push(`${prop}=${String(value)}`);
    return true;
  },
});

HTMLCanvasElement.prototype.getContext = vi.fn(
  () => recordingCtx,
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
      return recordingCtx;
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

// ─── Module mocks (must precede component import) ─────────────────────────

vi.mock('../../src/refine/loaders/rmbg14', () => ({
  createRmbg14Loader: vi.fn(() => ({
    label: 'mock',
    approxDownloadMb: 0,
    warmup: vi.fn(() => Promise.resolve()),
    run: vi.fn(),
  })),
}));
// disposeSam is reached from disconnectedCallback via SamRefiner, so the
// afterEach teardown needs it even though no test here touches SAM.
vi.mock('../../src/refine/loaders/mobile-sam', () => ({
  loadSam: vi.fn(() => Promise.resolve()),
  encodeSam: vi.fn(() => Promise.resolve()),
  decodeSam: vi.fn(() => Promise.resolve(new Uint8Array(16))),
  disposeSam: vi.fn(),
  onSamProgress: vi.fn(() => () => {}),
}));
vi.mock('../../src/refine/roi-process', () => ({
  processRoi: vi.fn(),
  rasterizePolygon: vi.fn(() => new Uint8Array(64)),
}));
vi.mock('../../src/workers/cv/patchmatch-inpaint', () => ({ patchMatchInpaint: vi.fn() }));
vi.mock('nukebg-core/pipeline/finalize', () => ({ refineEdges: vi.fn() }));

import '../../src/components/ar-editor-advanced';
import type { ArEditorAdvanced } from '../../src/components/ar-editor-advanced';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const IMG = 16;
/** PAD_RATIO is 0.25, so a 16px image gets a 4px pad and a 24px canvas. */
const PAD = 4;

function image(): ImageData {
  return new ImageData(new Uint8ClampedArray(IMG * IMG * 4).fill(255), IMG, IMG);
}

/**
 * Client coords map to image space as `(client - rect.left) * scale - pad`.
 * The rect is stubbed 1:1 with the canvas so `scale` is 1 and a client X of
 * `PAD + n` lands on image X `n` — keeps the expected values below readable.
 */
function clientFor(imageCoord: number): number {
  return PAD + imageCoord;
}

describe('advanced editor — drawing behaviour (#387)', () => {
  let editor: ArEditorAdvanced;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    editor = document.createElement('ar-editor-advanced') as ArEditorAdvanced;
    document.body.appendChild(editor);
    editor.setImage(image(), image());
    canvas = editor.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: canvas.width,
        height: canvas.height,
        right: canvas.width,
        bottom: canvas.height,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    calls.length = 0;
  });

  afterEach(() => {
    editor.remove();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  function selectTool(tool: 'brush' | 'eraser' | 'lasso'): void {
    (editor.shadowRoot!.getElementById(`tool-${tool}`) as HTMLElement).click();
  }

  function selectShape(shape: 'circle' | 'square'): void {
    (editor.shadowRoot!.getElementById(`shape-${shape}`) as HTMLElement).click();
  }

  function setRadius(r: number): void {
    const slider = editor.shadowRoot!.getElementById('brush-size') as HTMLInputElement;
    slider.value = String(r);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pointer(type: string, ix: number, iy: number, buttons = 0): void {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: clientFor(ix),
        clientY: clientFor(iy),
        bubbles: true,
        buttons,
      }),
    );
  }

  /**
   * The ops of one drawing pass: from the first `save()` to its `restore()`.
   * Everything after that is the display redraw and cursor preview, which are
   * a separate concern and would make these assertions fail for the wrong
   * reason.
   */
  function firstPass(): string[] {
    const from = calls.indexOf('save()');
    if (from === -1) return [];
    const to = calls.indexOf('restore()', from);
    return calls.slice(from, to === -1 ? undefined : to + 1);
  }

  // ─── What each tool/shape draws on a single press ───────────────────────

  describe('a single press draws the tool it was told to', () => {
    it('circle eraser strokes a round-capped line at twice the radius', () => {
      selectTool('eraser');
      selectShape('circle');
      setRadius(2);
      calls.length = 0;
      pointer('pointerdown', 2, 2);

      expect(firstPass()).toEqual([
        'save()',
        'globalCompositeOperation=destination-out',
        'lineCap=round',
        'lineJoin=round',
        'lineWidth=4',
        'beginPath()',
        'moveTo(2,2)',
        'lineTo(2,2)',
        'stroke()',
        'restore()',
      ]);
    });

    it('square eraser stamps axis-aligned rects instead of stroking', () => {
      selectTool('eraser');
      selectShape('square');
      setRadius(2);
      calls.length = 0;
      pointer('pointerdown', 2, 2);

      // Two stamps for a press: stampAlong always emits both endpoints, and
      // for a zero-length segment those coincide. Recorded, not endorsed.
      expect(firstPass()).toEqual([
        'save()',
        'globalCompositeOperation=destination-out',
        'fillRect(0,0,4,4)',
        'fillRect(0,0,4,4)',
        'restore()',
      ]);
    });

    it('circle brush clips to an arc and repaints from the original backing', () => {
      selectTool('brush');
      selectShape('circle');
      setRadius(2);
      calls.length = 0;
      pointer('pointerdown', 2, 2);

      expect(firstPass()).toEqual([
        'save()',
        'beginPath()',
        `arc(2,2,2,0,${Math.PI * 2})`,
        'clip()',
        'drawImage(<canvas width="16" height="16"></canvas>,0,0)',
        'restore()',
      ]);
    });

    it('square brush clips to a rect and repaints from the original backing', () => {
      selectTool('brush');
      selectShape('square');
      setRadius(2);
      calls.length = 0;
      pointer('pointerdown', 2, 2);

      expect(firstPass()).toEqual([
        'save()',
        'beginPath()',
        'rect(0,0,4,4)',
        'clip()',
        'drawImage(<canvas width="16" height="16"></canvas>,0,0)',
        'restore()',
      ]);
    });

    it('only the eraser punches through alpha; the brush restores it', () => {
      selectTool('eraser');
      setRadius(2);
      calls.length = 0;
      pointer('pointerdown', 2, 2);
      expect(firstPass()).toContain('globalCompositeOperation=destination-out');

      selectTool('brush');
      calls.length = 0;
      pointer('pointerdown', 2, 2);
      expect(firstPass()).not.toContain('globalCompositeOperation=destination-out');
    });
  });

  // ─── Stamp spacing along a drag ─────────────────────────────────────────

  describe('a drag stamps along the segment, not just at its ends', () => {
    /**
     * The stepping is `step = max(1, r * 0.4)` and `steps = ceil(dist / step)`,
     * with a stamp at every `i` from 0 to steps inclusive — so a drag emits
     * `steps + 1` stamps and always includes both endpoints.
     */
    function stampsFor(radius: number, fromX: number, toX: number): string[] {
      selectTool('eraser');
      selectShape('square');
      setRadius(radius);
      pointer('pointerdown', fromX, 0);
      calls.length = 0;
      pointer('pointermove', toX, 0, 1);
      return firstPass().filter((op) => op.startsWith('fillRect'));
    }

    function xsOf(stamps: string[]): number[] {
      return stamps.map((s) => Number(s.slice('fillRect('.length).split(',')[0]));
    }

    it('a small radius stamps densely enough that consecutive stamps overlap', () => {
      // r=2 -> step 1 -> 12 steps over 12px -> 13 stamps, one per pixel.
      const stamps = stampsFor(2, 0, 12);
      expect(stamps).toHaveLength(13);
      // No gaps, no doubling: every stamp is exactly 1px right of the last.
      expect(xsOf(stamps)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('a larger radius spaces stamps further apart, since they still overlap', () => {
      // r=10 -> step 4 -> ceil(12/4)=3 steps -> 4 stamps.
      const stamps = stampsFor(10, 0, 12);
      expect(stamps).toHaveLength(4);
      expect(xsOf(stamps)).toEqual([-10, -6, -2, 2]);
    });

    /**
     * Pins the 0.4 in `step = max(1, r * 0.4)` specifically.
     *
     * The two cases above cannot: stamp positions are `from + d * (i/steps)`,
     * so the step only decides how many stamps there are, not how far apart
     * they land. At r=2 the floor of 1 swallows the difference, and at r=10
     * over 12px both 0.4 and 0.5 happen to round to the same `steps`. A
     * mutation run proved that hole by changing 0.4 to 0.5 and watching the
     * whole suite stay green.
     *
     * r=5 over 11px separates them: step 2.0 gives ceil(11/2)=6 steps and 7
     * stamps, step 2.5 gives ceil(11/2.5)=5 and 6.
     */
    it('the stamp count follows the 0.4 factor, not just any factor', () => {
      expect(stampsFor(5, 0, 11)).toHaveLength(7);
    });

    it('the stamp footprint is the full square, twice the radius on a side', () => {
      for (const s of stampsFor(3, 0, 0)) expect(s).toBe('fillRect(-3,-3,6,6)');
    });
  });

  // ─── Radius bounds ──────────────────────────────────────────────────────

  describe('brush radius is clamped to its declared bounds', () => {
    it.each([
      ['below the floor', -5, '1'],
      ['at the floor', 0, '1'],
      ['the floor itself', 1, '1'],
      ['a normal value', 24, '24'],
      ['the ceiling itself', 120, '120'],
      ['above the ceiling', 999, '120'],
    ])('%s: %d is shown as %s', (_label, input, shown) => {
      setRadius(input as number);
      expect(editor.shadowRoot!.getElementById('brush-size-val')!.textContent).toBe(shown);
    });

    it('the clamp reaches the pixels, not just the label', () => {
      selectTool('eraser');
      selectShape('circle');
      setRadius(999);
      calls.length = 0;
      pointer('pointerdown', 2, 2);
      // lineWidth is 2r, so the ceiling of 120 must show up as 240.
      expect(firstPass()).toContain('lineWidth=240');
    });
  });
});
