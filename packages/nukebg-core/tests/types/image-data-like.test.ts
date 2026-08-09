import { describe, it, expect } from 'vitest';
import { createImageDataLike } from '../../src/types/image-data-like.js';
import type { ImageDataLike } from '../../src/types/image-data-like.js';

describe('ImageDataLike', () => {
  describe('createImageDataLike', () => {
    it('returns a plain object with data, width, and height', () => {
      const data = new Uint8ClampedArray([255, 0, 0, 255]);
      const result = createImageDataLike(data, 1, 1);

      expect(result).toEqual({ data, width: 1, height: 1 });
    });

    it('preserves the exact Uint8ClampedArray reference', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4);
      const result = createImageDataLike(data, 4, 4);

      expect(result.data).toBe(data);
    });

    it('sets width and height correctly', () => {
      const data = new Uint8ClampedArray(10 * 20 * 4);
      const result = createImageDataLike(data, 10, 20);

      expect(result.width).toBe(10);
      expect(result.height).toBe(20);
    });

    it('does NOT set colorSpace by default', () => {
      const data = new Uint8ClampedArray(4);
      const result = createImageDataLike(data, 1, 1);

      expect('colorSpace' in result).toBe(false);
    });

    it('returns a plain object, not an ImageData instance', () => {
      const data = new Uint8ClampedArray(4);
      const result = createImageDataLike(data, 1, 1);

      // Should be a plain object
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
  });

  describe('ImageDataLike interface structural compliance', () => {
    it('a plain object with data/width/height satisfies the interface', () => {
      const data = new Uint8ClampedArray(4);
      // This assignment must compile without @ts-expect-error
      const img: ImageDataLike = { data, width: 1, height: 1 };

      expect(img.data).toBe(data);
      expect(img.width).toBe(1);
      expect(img.height).toBe(1);
    });

    it('colorSpace field is optional and accepted when present', () => {
      const data = new Uint8ClampedArray(4);
      // colorSpace is optional — should compile fine
      const img: ImageDataLike = { data, width: 1, height: 1, colorSpace: 'srgb' };

      expect(img.colorSpace).toBe('srgb');
    });

    it('colorSpace accepts display-p3', () => {
      const data = new Uint8ClampedArray(4);
      const img: ImageDataLike = { data, width: 1, height: 1, colorSpace: 'display-p3' };

      expect(img.colorSpace).toBe('display-p3');
    });
  });
});
