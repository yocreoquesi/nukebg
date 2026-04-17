import { describe, it, expect } from 'vitest';
import {
  dropOrphanBlobs,
  fillSubjectHoles,
  promoteSpeckleAlpha,
} from '../../src/pipeline/finalize';

// ImageData polyfill for happy-dom.
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class ImageData {
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

// End-to-end topology cleanup chain: the same composition ar-app.ts applies
// on the PHOTO/ILLUSTRATION path. Guards that chaining the three passes
// produces a coherent output — no enclosed α=0 holes, no interior specks,
// no disconnected α>0 blobs.
const runChain = (img: ImageData): ImageData =>
  promoteSpeckleAlpha(fillSubjectHoles(dropOrphanBlobs(img)));

// Build a synthetic image containing every defect class the chain must cure.
const makeDefectiveSubject = () => {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  // Solid body at (5,5)-(34,34): α=255, RGB=(200,100,50).
  for (let y = 5; y <= 34; y++) {
    for (let x = 5; x <= 34; x++) {
      const i = (y * w + x) * 4;
      data[i + 0] = 200;
      data[i + 1] = 100;
      data[i + 2] = 50;
      data[i + 3] = 255;
    }
  }
  // Defect 1: orphan α>0 blob at (38,38) disconnected from the main body.
  data[(38 * w + 38) * 4 + 3] = 255;
  // Defect 2: topologically enclosed α=0 hole at (20,20).
  data[(20 * w + 20) * 4 + 3] = 0;
  // Defect 3: α-intermediate speck at (15,15) surrounded by α=255 neighbors.
  data[(15 * w + 15) * 4 + 3] = 150;
  return new ImageData(data, w, h);
};

// Count enclosed α=0 clusters — topology oracle used as the output invariant.
const countEnclosedHoles = (img: ImageData): number => {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const queue = new Int32Array(n);
  const bg = new Uint8Array(n);
  let head = 0, tail = 0;
  const seed = (i: number) => { if (data[i * 4 + 3] === 0 && !bg[i]) { bg[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i - x) / w;
    const push = (ni: number) => { if (data[ni * 4 + 3] === 0 && !bg[ni]) { bg[ni] = 1; queue[tail++] = ni; } };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const seen = new Uint8Array(n);
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] !== 0 || bg[i] || seen[i]) continue;
    holes++;
    head = 0; tail = 0; queue[tail++] = i; seen[i] = 1;
    while (head < tail) {
      const j = queue[head++];
      const x = j % w, y = (j - x) / w;
      const push = (nj: number) => { if (data[nj * 4 + 3] === 0 && !bg[nj] && !seen[nj]) { seen[nj] = 1; queue[tail++] = nj; } };
      if (x > 0) push(j - 1);
      if (x < w - 1) push(j + 1);
      if (y > 0) push(j - w);
      if (y < h - 1) push(j + w);
    }
  }
  return holes;
};

// Count interior α-intermediate specks with ≥80% opaque neighbors in 5×5.
const countInteriorSpecks = (img: ImageData): number => {
  const { data, width: w, height: h } = img;
  let count = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a === 0 || a === 255) continue;
      let opaque = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (data[((y + dy) * w + (x + dx)) * 4 + 3] >= 240) opaque++;
        }
      }
      if (opaque / 24 >= 0.8) count++;
    }
  }
  return count;
};

describe('finalize chain (dropOrphanBlobs → fillSubjectHoles → promoteSpeckleAlpha)', () => {
  it('kills disconnected orphan α>0 blobs', () => {
    const out = runChain(makeDefectiveSubject());
    // Orphan at (38,38) must be α=0.
    expect(out.data[(38 * 40 + 38) * 4 + 3]).toBe(0);
  });

  it('fills small topologically enclosed α=0 holes', () => {
    const out = runChain(makeDefectiveSubject());
    // Enclosed hole at (20,20) must now be opaque.
    expect(out.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });

  it('promotes α-intermediate specks surrounded by opaque body', () => {
    const out = runChain(makeDefectiveSubject());
    // Speck at (15,15) must now be α=255.
    expect(out.data[(15 * 40 + 15) * 4 + 3]).toBe(255);
  });

  it('produces zero enclosed holes on output', () => {
    const out = runChain(makeDefectiveSubject());
    expect(countEnclosedHoles(out)).toBe(0);
  });

  it('produces zero locally-enclosed interior specks on output', () => {
    const out = runChain(makeDefectiveSubject());
    expect(countInteriorSpecks(out)).toBe(0);
  });

  it('preserves the main body (all of its pixels stay α=255)', () => {
    const out = runChain(makeDefectiveSubject());
    const w = 40;
    for (let y = 5; y <= 34; y++) {
      for (let x = 5; x <= 34; x++) {
        if (x === 20 && y === 20) continue; // the enclosed hole, verified above
        if (x === 15 && y === 15) continue; // the promoted speck, verified above
        expect(out.data[(y * w + x) * 4 + 3]).toBe(255);
      }
    }
  });

  it('preserves RGB on every pixel (the chain only edits α)', () => {
    const input = makeDefectiveSubject();
    const rgbSnapshot: number[] = [];
    for (let i = 0; i < input.data.length; i += 4) {
      rgbSnapshot.push(input.data[i], input.data[i + 1], input.data[i + 2]);
    }
    const out = runChain(input);
    for (let i = 0, j = 0; i < out.data.length; i += 4, j += 3) {
      expect(out.data[i + 0]).toBe(rgbSnapshot[j + 0]);
      expect(out.data[i + 1]).toBe(rgbSnapshot[j + 1]);
      expect(out.data[i + 2]).toBe(rgbSnapshot[j + 2]);
    }
  });

  it('does not mutate the input ImageData', () => {
    const input = makeDefectiveSubject();
    const snapshot = Array.from(input.data);
    runChain(input);
    expect(Array.from(input.data)).toEqual(snapshot);
  });
});
