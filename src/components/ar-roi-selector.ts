/**
 * Freehand ROI selector — paints a closed lasso over the loaded image so the
 * lab can reprocess only that region. Staging-only; gated by isLabVisible().
 *
 * Usage: ar-app calls setImage(imageData) to load the source, then shows the
 * component. When the user confirms with "Crop" or "Refine", the component
 * dispatches `ar:roi-done` with { points, mode } in image-space coordinates.
 * ar-app runs the actual segmentation via the rmbg-1.4 lab loader + processRoi.
 *
 * UX: pointerdown starts a stroke, pointermove appends points, pointerup ends
 * it. The path auto-closes in the rasterizer, so the user doesn't have to
 * return to the origin. A "Clear" button resets; "Crop" / "Refine" emit.
 */

import { isLabVisible } from '../../exploration/lab-visibility';
import type { PolygonPoint } from '../../exploration/roi-process';

export interface RoiDoneDetail {
  points: PolygonPoint[];
  mode: 'crop' | 'refine';
}

export class ArRoiSelector extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sourceImage: ImageData | null = null;
  private points: PolygonPoint[] = [];
  private drawing = false;
  private hasPreviousResult = false;

  connectedCallback(): void {
    if (!isLabVisible()) {
      this.style.display = 'none';
      return;
    }
    this.render();
  }

  setImage(imageData: ImageData, hasPreviousResult: boolean): void {
    this.sourceImage = imageData;
    this.hasPreviousResult = hasPreviousResult;
    this.points = [];
    this.paintCanvas();
    this.updateButtons();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: none;
          margin-top: 12px;
          padding: 12px;
          border: 1px dashed var(--color-accent, #ffd700);
          border-radius: 4px;
          background: rgba(255, 215, 0, 0.04);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--color-text, #ddd);
        }
        :host([active]) { display: block; }
        .title {
          color: var(--color-accent, #ffd700);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .canvas-wrap {
          background:
            linear-gradient(45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(-45deg, #1a1a1a 25%, transparent 25%) 0 0 / 12px 12px,
            linear-gradient(45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            linear-gradient(-45deg, transparent 75%, #1a1a1a 75%) 6px 6px / 12px 12px,
            #0d0d0d;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 200px;
        }
        canvas {
          max-width: 100%;
          max-height: 60vh;
          display: block;
          cursor: crosshair;
          touch-action: none;
        }
        .controls {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .hint {
          flex: 1;
          font-size: 10px;
          color: var(--color-text-tertiary, #888);
          align-self: center;
        }
        button {
          font-family: inherit;
          font-size: 12px;
          background: var(--color-bg, #111);
          color: var(--color-accent, #ffd700);
          border: 1px solid var(--color-accent, #ffd700);
          border-radius: 2px;
          padding: 5px 12px;
          cursor: pointer;
        }
        button:hover:not(:disabled) { background: var(--color-accent, #ffd700); color: #000; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        button.secondary { color: var(--color-text-secondary, #999); border-color: var(--color-border, #444); }
      </style>
      <div class="title">[LAB] Freehand region selection</div>
      <div class="canvas-wrap"><canvas></canvas></div>
      <div class="controls">
        <span class="hint">Paint a loop around the region. It auto-closes on release.</span>
        <button class="secondary" id="clear">Clear</button>
        <button class="secondary" id="cancel">Cancel</button>
        <button id="crop">Crop to area</button>
        <button id="refine">Refine this area</button>
      </div>
    `;

    this.canvas = shadow.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');

    this.canvas.addEventListener('pointerdown', (e) => this.handleDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.handleMove(e));
    this.canvas.addEventListener('pointerup', () => this.handleUp());
    this.canvas.addEventListener('pointerleave', () => this.handleUp());

    shadow.getElementById('clear')!.addEventListener('click', () => this.clearStroke());
    shadow.getElementById('cancel')!.addEventListener('click', () => this.cancel());
    shadow.getElementById('crop')!.addEventListener('click', () => this.emitDone('crop'));
    shadow.getElementById('refine')!.addEventListener('click', () => this.emitDone('refine'));

    this.updateButtons();
  }

  private paintCanvas(): void {
    if (!this.canvas || !this.ctx || !this.sourceImage) return;
    this.canvas.width = this.sourceImage.width;
    this.canvas.height = this.sourceImage.height;
    this.ctx.putImageData(this.sourceImage, 0, 0);
    this.drawOverlay();
  }

  private drawOverlay(): void {
    if (!this.ctx || !this.canvas) return;
    if (this.points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = Math.max(2, this.canvas.width / 400);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    if (!this.drawing) ctx.closePath();
    ctx.stroke();
    if (!this.drawing) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.12)';
      ctx.fill();
    }
    ctx.restore();
  }

  private localPoint(e: PointerEvent): PolygonPoint {
    const rect = this.canvas!.getBoundingClientRect();
    const scaleX = this.canvas!.width / rect.width;
    const scaleY = this.canvas!.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private handleDown(e: PointerEvent): void {
    if (!this.sourceImage) return;
    this.canvas?.setPointerCapture(e.pointerId);
    this.drawing = true;
    this.points = [this.localPoint(e)];
    this.paintCanvas();
  }

  private handleMove(e: PointerEvent): void {
    if (!this.drawing) return;
    const p = this.localPoint(e);
    const last = this.points[this.points.length - 1];
    // Throttle: skip points closer than 2 pixels to keep the path compact.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
    this.points.push(p);
    this.paintCanvas();
  }

  private handleUp(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.paintCanvas();
    this.updateButtons();
  }

  private clearStroke(): void {
    this.points = [];
    this.drawing = false;
    this.paintCanvas();
    this.updateButtons();
  }

  private cancel(): void {
    this.clearStroke();
    this.dispatchEvent(new CustomEvent('ar:roi-cancel', { bubbles: true, composed: true }));
  }

  private updateButtons(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const hasPath = this.points.length >= 3 && !this.drawing;
    (shadow.getElementById('crop') as HTMLButtonElement).disabled = !hasPath;
    (shadow.getElementById('refine') as HTMLButtonElement).disabled =
      !hasPath || !this.hasPreviousResult;
  }

  private emitDone(mode: 'crop' | 'refine'): void {
    if (this.points.length < 3) return;
    const detail: RoiDoneDetail = { points: [...this.points], mode };
    this.dispatchEvent(
      new CustomEvent('ar:roi-done', { detail, bubbles: true, composed: true }),
    );
  }
}

customElements.define('ar-roi-selector', ArRoiSelector);
