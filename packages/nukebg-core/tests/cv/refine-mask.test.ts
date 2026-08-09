import { describe, it, expect } from 'vitest';
import {
  refineMask,
  removeSmallClusters,
  morphOpen,
  spatialPass,
} from '../../src/cv/refine-mask.js';
import { PRECISION_PROFILES } from '../../src/pipeline/constants.js';

// The refinement chain used to live as private helpers inside the browser's
// ml.worker.ts, so the Node runner had nothing to call and silently ignored
// its `refine` profile — `--precision` only moved `rmbgThreshold` (issue #327).
//
// The load-bearing test here is "different profiles produce different masks":
// that is the assertion that was impossible to satisfy before the port, and
// the one that fails again if a future runner drops the profile on the floor.

/** Big opaque square plus a small detached speck. */
function maskWithSpeck(w = 40, h = 40): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 4; y < 24; y++) {
    for (let x = 4; x < 24; x++) m[y * w + x] = 255;
  }
  // Detached 2x2 speck far from the subject.
  for (let y = 33; y < 35; y++) {
    for (let x = 33; x < 35; x++) m[y * w + x] = 255;
  }
  return m;
}

describe('removeSmallClusters', () => {
  it('drops a detached speck and keeps the subject', () => {
    const w = 40;
    const h = 40;
    const out = removeSmallClusters(maskWithSpeck(w, h), w, h, 16, 0.1);

    expect(out[33 * w + 33]).toBe(0); // speck gone
    expect(out[10 * w + 10]).toBe(255); // subject intact
  });

  it('keeps everything when only one component exists', () => {
    const w = 20;
    const h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * w + x] = 255;

    const out = removeSmallClusters(m, w, h, 999, 0.9);

    // The largest component is never removed, however aggressive the limits.
    expect(Array.from(out).some((v) => v === 255)).toBe(true);
  });
});

describe('morphOpen', () => {
  it('erodes a one-pixel protrusion but preserves the body', () => {
    const w = 20;
    const h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * w + x] = 255;
    m[10 * w + 17] = 255; // lone pixel away from the body

    const out = morphOpen(m, w, h, 1);

    expect(out[10 * w + 17]).toBe(0);
    expect(out[10 * w + 10]).toBe(255);
  });
});

describe('spatialPass', () => {
  it('clears a semi-transparent pixel surrounded by transparency', () => {
    const w = 11;
    const h = 11;
    const m = new Uint8Array(w * h);
    m[5 * w + 5] = 120; // lone mid-alpha pixel on an empty field

    const out = spatialPass(m, w, h, 2);

    expect(out[5 * w + 5]).toBe(0);
  });

  it('leaves fully opaque and fully transparent pixels untouched', () => {
    const w = 9;
    const h = 9;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = 255;

    const out = spatialPass(m, w, h, 1);

    expect(Array.from(out).every((v) => v === 255)).toBe(true);
  });
});

describe('refineMask honours the precision profile', () => {
  /**
   * Subject square with a one-pixel-wide arm attached to it.
   *
   * The arm is what separates the profiles: it stays connected to the subject
   * so cluster removal never touches it, but `morphOpenRadius` is 0 in
   * `low-power` and 2 in `full-nuke`, so only the aggressive profile erodes
   * it away. A mask of solid blocks alone is refined identically by every
   * profile and would make this assertion vacuous.
   */
  function maskWithThinArm(w = 40, h = 40): Uint8Array {
    const m = new Uint8Array(w * h);
    for (let y = 8; y < 28; y++) {
      for (let x = 8; x < 28; x++) m[y * w + x] = 255;
    }
    for (let x = 28; x < 38; x++) m[18 * w + x] = 255;
    return m;
  }

  it('produces different masks for different profiles', () => {
    const w = 40;
    const h = 40;
    const input = maskWithThinArm(w, h);

    const low = refineMask(input, w, h, PRECISION_PROFILES['low-power']);
    const nuke = refineMask(input, w, h, PRECISION_PROFILES['full-nuke']);

    // Before the port both calls returned the input untouched, so this
    // comparison was trivially equal — the defect in issue #327.
    expect(Array.from(low)).not.toEqual(Array.from(nuke));

    // Name the actual difference so a future change that makes the masks
    // differ for some unrelated reason does not quietly satisfy this test.
    expect(low[18 * w + 34]).toBeGreaterThan(0); // low-power keeps the arm
    expect(nuke[18 * w + 34]).toBe(0); // full-nuke erodes it
  });

  it('does not mutate the input mask', () => {
    const w = 40;
    const h = 40;
    const input = maskWithSpeck(w, h);
    const copy = Uint8Array.from(input);

    refineMask(input, w, h, PRECISION_PROFILES['normal']);

    expect(Array.from(input)).toEqual(Array.from(copy));
  });

  it('falls back to REFINE_PARAMS defaults when given no profile', () => {
    const w = 40;
    const h = 40;
    const out = refineMask(maskWithSpeck(w, h), w, h);

    // Defaults still run the chain: the detached speck is removed.
    expect(out[33 * w + 33]).toBe(0);
    expect(out[10 * w + 10]).toBeGreaterThan(0);
  });
});
