import { describe, it, expect } from 'vitest';
import type {
  BgColorResult,
  WatermarkResult,
  ClassifyImageResult,
  ImageFeatures,
  GridResult,
} from '../../src/types/cv-results.js';

describe('cv-results types', () => {
  describe('BgColorResult', () => {
    it('has colorA, colorB as RGB arrays, isCheckerboard boolean, cornerVariance number', () => {
      const result: BgColorResult = {
        colorA: [255, 255, 255],
        colorB: [200, 200, 200],
        isCheckerboard: false,
        cornerVariance: 0.02,
      };

      expect(result.colorA).toHaveLength(3);
      expect(result.colorB).toHaveLength(3);
      expect(typeof result.isCheckerboard).toBe('boolean');
      expect(typeof result.cornerVariance).toBe('number');
    });

    it('isCheckerboard can be true', () => {
      const result: BgColorResult = {
        colorA: [255, 255, 255],
        colorB: [0, 0, 0],
        isCheckerboard: true,
        cornerVariance: 0.95,
      };

      expect(result.isCheckerboard).toBe(true);
    });
  });

  describe('WatermarkResult', () => {
    it('has detected boolean and mask field', () => {
      const result: WatermarkResult = {
        detected: false,
        mask: null,
      };

      expect(result.detected).toBe(false);
      expect(result.mask).toBeNull();
    });

    it('mask can be a Uint8Array when detected', () => {
      const mask = new Uint8Array(100);
      const result: WatermarkResult = {
        detected: true,
        mask,
        centerX: 50,
        centerY: 50,
        radius: 20,
      };

      expect(result.mask).toBe(mask);
      expect(result.centerX).toBe(50);
      expect(result.centerY).toBe(50);
      expect(result.radius).toBe(20);
    });

    it('optional center/radius fields can be absent', () => {
      const result: WatermarkResult = {
        detected: true,
        mask: new Uint8Array(4),
      };

      expect(result.centerX).toBeUndefined();
      expect(result.centerY).toBeUndefined();
      expect(result.radius).toBeUndefined();
    });
  });

  describe('ClassifyImageResult', () => {
    it('has type field as PHOTO | SIGNATURE | ICON and confidence number', () => {
      const result: ClassifyImageResult = {
        type: 'PHOTO',
        confidence: 0.92,
      };

      expect(result.type).toBe('PHOTO');
      expect(typeof result.confidence).toBe('number');
    });

    it('type can be SIGNATURE', () => {
      const result: ClassifyImageResult = { type: 'SIGNATURE', confidence: 0.85 };
      expect(result.type).toBe('SIGNATURE');
    });

    it('type can be ICON', () => {
      const result: ClassifyImageResult = { type: 'ICON', confidence: 0.77 };
      expect(result.type).toBe('ICON');
    });
  });

  describe('ImageFeatures', () => {
    it('has edgeDensity, colorVariance, centerMass, hasTransparency', () => {
      const features: ImageFeatures = {
        edgeDensity: 0.3,
        colorVariance: 12.5,
        centerMass: { x: 0.5, y: 0.5 },
        hasTransparency: false,
      };

      expect(typeof features.edgeDensity).toBe('number');
      expect(typeof features.colorVariance).toBe('number');
      expect(typeof features.centerMass.x).toBe('number');
      expect(typeof features.centerMass.y).toBe('number');
      expect(typeof features.hasTransparency).toBe('boolean');
    });
  });

  describe('GridResult', () => {
    it('has gridSize and phase as numbers', () => {
      const result: GridResult = {
        gridSize: 16,
        phase: 0,
      };

      expect(result.gridSize).toBe(16);
      expect(typeof result.phase).toBe('number');
    });
  });
});
