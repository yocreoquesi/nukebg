import { describe, it, expect } from 'vitest';
import {
  bilinearResizeRGBA,
  computeLamaCropRect,
  nearestResizeMask,
  spliceLamaOutput,
  resampleMask,
  packRgbaToChw,
  packMaskToChw,
  unpackChwToRgba,
} from '../src/index';

// Regression guard for review #1: the CLI runners import these from the
// package ROOT ('nukebg-core'), because core's package.json `exports` map
// only exposes '.'. A subpath import like 'nukebg-core/cv/lama-crop' throws
// ERR_PACKAGE_PATH_NOT_EXPORTED in real Node. These assertions fail the build
// if any of the shared building blocks stops being reachable from the root.
describe('package root barrel exports', () => {
  it('exposes the LaMa crop helpers as named exports', () => {
    expect(typeof bilinearResizeRGBA).toBe('function');
    expect(typeof computeLamaCropRect).toBe('function');
    expect(typeof nearestResizeMask).toBe('function');
    expect(typeof spliceLamaOutput).toBe('function');
  });

  it('exposes the shared mask resampler', () => {
    expect(typeof resampleMask).toBe('function');
  });

  it('exposes the shared LaMa tensor packing helpers', () => {
    expect(typeof packRgbaToChw).toBe('function');
    expect(typeof packMaskToChw).toBe('function');
    expect(typeof unpackChwToRgba).toBe('function');
  });
});
