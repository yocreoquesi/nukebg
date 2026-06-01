import { describe, it, expect } from 'vitest';
import { estimateForeground } from '../../src/workers/cv/foreground-estimation';

/**
 * Synthetic compositing: I = α·F + (1−α)·B
 * Returns packed RGBA (alpha set to 255 in source; the caller passes a
 * separate α buffer to estimateForeground).
 */
function composite(
  fgRgb: [number, number, number],
  bgRgb: [number, number, number],
  alphaF: number,
): [number, number, number] {
  return [
    Math.round(alphaF * fgRgb[0] + (1 - alphaF) * bgRgb[0]),
    Math.round(alphaF * fgRgb[1] + (1 - alphaF) * bgRgb[1]),
    Math.round(alphaF * fgRgb[2] + (1 - alphaF) * bgRgb[2]),
  ];
}

function makeScene(
  w: number,
  h: number,
  fg: [number, number, number],
  bg: [number, number, number],
  alphaAt: (x: number, y: number) => number,
): { observed: Uint8ClampedArray; alpha: Uint8Array } {
  const observed = new Uint8ClampedArray(w * h * 4);
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alphaAt(x, y); // 0..255
      const aF = a / 255;
      const [r, g, b] = composite(fg, bg, aF);
      const i = y * w + x;
      observed[i * 4] = r;
      observed[i * 4 + 1] = g;
      observed[i * 4 + 2] = b;
      observed[i * 4 + 3] = 255;
      alpha[i] = a;
    }
  }
  return { observed, alpha };
}

describe('estimateForeground', () => {
  it('fully opaque pixels are copied verbatim (no round-trip error)', () => {
    const w = 16,
      h = 16;
    const { observed, alpha } = makeScene(w, h, [200, 50, 50], [30, 30, 30], () => 255);
    const out = estimateForeground(observed, alpha, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4]).toBe(200);
      expect(out[i * 4 + 1]).toBe(50);
      expect(out[i * 4 + 2]).toBe(50);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it('fully transparent pixels output alpha=0', () => {
    const w = 16,
      h = 16;
    const { observed, alpha } = makeScene(w, h, [200, 50, 50], [30, 30, 30], () => 0);
    const out = estimateForeground(observed, alpha, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4 + 3]).toBe(0);
    }
  });

  it('recovers foreground on a partial-alpha halo surrounded by opaque + transparent anchors', () => {
    // Horizontal stripes: α=255 (0..20), α=128 (20..40), α=0 (40..60).
    // The opaque and transparent stripes anchor F and B respectively, and
    // the solver propagates them into the middle band.
    const w = 60,
      h = 60;
    const FG: [number, number, number] = [230, 0, 0];
    const BG: [number, number, number] = [0, 230, 0];
    const { observed, alpha } = makeScene(w, h, FG, BG, (x) => {
      if (x < 20) return 255;
      if (x < 40) return 128;
      return 0;
    });
    const out = estimateForeground(observed, alpha, w, h, { iterationsPerLevel: 12 });

    // Sample middle band far from boundaries.
    let dr = 0,
      dg = 0,
      db = 0,
      n = 0;
    for (let y = 10; y < h - 10; y++) {
      for (let x = 25; x < 35; x++) {
        const i = y * w + x;
        dr += Math.abs(out[i * 4] - FG[0]);
        dg += Math.abs(out[i * 4 + 1] - FG[1]);
        db += Math.abs(out[i * 4 + 2] - FG[2]);
        n++;
      }
    }
    const avgRed = dr / n;
    const avgGreen = dg / n;
    const avgBlue = db / n;
    expect(avgRed).toBeLessThan(80);
    expect(avgGreen).toBeLessThan(80);
    expect(avgBlue).toBeLessThan(30);
  });

  it('recovers foreground on edge pixels when anchored by opaque interior', () => {
    // Center disc α=255 (pure FG), ring of α=128 around it, bg α=0 outside.
    // The solver has strong anchoring from the opaque core — edge pixels
    // should come out very close to FG color.
    const w = 64,
      h = 64;
    const cx = w / 2,
      cy = h / 2;
    const FG: [number, number, number] = [255, 0, 0];
    const BG: [number, number, number] = [0, 255, 0];
    const { observed, alpha } = makeScene(w, h, FG, BG, (x, y) => {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d < 15) return 255;
      if (d < 22) return 128;
      return 0;
    });

    const out = estimateForeground(observed, alpha, w, h, { iterationsPerLevel: 12 });

    // Sample a ring pixel at d ≈ 18
    const ringX = Math.round(cx + 18);
    const ringY = Math.round(cy);
    const i = ringY * w + ringX;
    expect(alpha[i]).toBe(128);
    // With anchoring, recovered FG on the ring should be much redder than
    // the observed green ghost (128,128,0 would be the naive composite).
    expect(out[i * 4]).toBeGreaterThan(150); // red dominant
    expect(out[i * 4 + 1]).toBeLessThan(100); // green stripped
  });

  it('does not touch alpha channel', () => {
    const w = 32,
      h = 32;
    const { observed, alpha } = makeScene(
      w,
      h,
      [128, 64, 32],
      [200, 200, 200],
      (x, y) => (x + y) % 256,
    );
    const out = estimateForeground(observed, alpha, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4 + 3]).toBe(alpha[i]);
    }
  });

  it('handles degenerate tiny inputs without throwing', () => {
    const w = 4,
      h = 4;
    const { observed, alpha } = makeScene(w, h, [100, 100, 100], [0, 0, 0], () => 128);
    expect(() => estimateForeground(observed, alpha, w, h)).not.toThrow();
  });

  it('output array length is 4 × width × height', () => {
    const w = 10,
      h = 7;
    const { observed, alpha } = makeScene(w, h, [100, 100, 100], [50, 50, 50], () => 200);
    const out = estimateForeground(observed, alpha, w, h);
    expect(out.length).toBe(w * h * 4);
  });
});
