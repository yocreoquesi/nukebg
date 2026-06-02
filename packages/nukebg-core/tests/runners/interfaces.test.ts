import { describe, it, expect } from 'vitest';
import type { PipelineRunner } from '../../src/runners/pipeline-runner.js';
import type { RmbgRunner, RmbgRefineOptions } from '../../src/runners/rmbg-runner.js';
import type { LamaRunner } from '../../src/runners/lama-runner.js';
import type { ImageCodec, EncodeFormat } from '../../src/runners/image-codec.js';
import { createImageDataLike } from '../../src/types/image-data-like.js';

describe('Runner interface structural compliance (REQ-CORE-RUNNERS-1 through 4)', () => {
  const makeImageDataLike = () => createImageDataLike(new Uint8ClampedArray(4), 1, 1);

  describe('RmbgRunner (REQ-CORE-RUNNERS-1)', () => {
    it('an object literal satisfying RmbgRunner compiles without error', () => {
      const refineOpts: RmbgRefineOptions = {
        spatialPasses: 3,
        spatialRadius: 5,
        morphOpenRadius: 2,
        clusterRatio: 0.5,
        minClusterSize: 10,
      };

      const runner: RmbgRunner = {
        segment: async (_input, _opts) => new Uint8Array(1),
        dispose: async () => undefined,
      };

      expect(typeof runner.segment).toBe('function');
      expect(typeof runner.dispose).toBe('function');
      void refineOpts;
    });

    it('RmbgRunner.load is optional', () => {
      // No load property — still satisfies interface
      const runner: RmbgRunner = {
        segment: async (_input, _opts) => new Uint8Array(1),
        dispose: async () => undefined,
      };

      expect(runner.load).toBeUndefined();
    });

    it('RmbgRunner with load included compiles fine', () => {
      const runner: RmbgRunner = {
        load: async () => undefined,
        segment: async (_input, _opts) => new Uint8Array(1),
        dispose: async () => undefined,
      };

      expect(typeof runner.load).toBe('function');
    });

    it('RmbgRefineOptions has all required fields', () => {
      const opts: RmbgRefineOptions = {
        spatialPasses: 2,
        spatialRadius: 3,
        morphOpenRadius: 1,
        clusterRatio: 0.8,
        minClusterSize: 5,
      };

      expect(opts.spatialPasses).toBe(2);
      expect(opts.spatialRadius).toBe(3);
      expect(opts.morphOpenRadius).toBe(1);
      expect(opts.clusterRatio).toBe(0.8);
      expect(opts.minClusterSize).toBe(5);
    });
  });

  describe('LamaRunner (REQ-CORE-RUNNERS-2)', () => {
    it('an object literal satisfying LamaRunner compiles without error', () => {
      const runner: LamaRunner = {
        inpaint: async (_input, _mask) => new Uint8ClampedArray(4),
        dispose: async () => undefined,
      };

      expect(typeof runner.inpaint).toBe('function');
      expect(typeof runner.dispose).toBe('function');
    });

    it('LamaRunner.load is optional', () => {
      const runner: LamaRunner = {
        inpaint: async (_input, _mask) => new Uint8ClampedArray(4),
        dispose: async () => undefined,
      };

      expect(runner.load).toBeUndefined();
    });
  });

  describe('ImageCodec (REQ-CORE-RUNNERS-3)', () => {
    it('an object literal satisfying ImageCodec compiles without error', () => {
      const codec: ImageCodec = {
        decode: async (_bytes) => ({
          image: makeImageDataLike(),
          originalWidth: 1,
          originalHeight: 1,
          wasDownsampled: false,
        }),
        encode: async (_image, _format) => new Uint8Array(0),
      };

      expect(typeof codec.decode).toBe('function');
      expect(typeof codec.encode).toBe('function');
    });

    it('EncodeFormat accepts png and webp', () => {
      const formats: EncodeFormat[] = ['png', 'webp'];
      expect(formats).toHaveLength(2);
    });
  });

  describe('PipelineRunner (REQ-CORE-RUNNERS-4)', () => {
    it('an object literal satisfying PipelineRunner compiles without error', () => {
      const runner: PipelineRunner = {
        run: async (_input, _opts) => ({
          output: makeImageDataLike(),
          resolvedMode: 'photo',
          durationMs: 100,
          stageTimings: { watermark: 0, rmbg: 100, inpaint: 0, finalize: 0 },
          watermarkRemoved: false,
          watermarkMask: null,
          workingPixels: new Uint8ClampedArray(4),
          workingAlpha: new Uint8Array(1),
          nukedPct: 0,
          contentType: 'PHOTO',
        }),
        dispose: async () => undefined,
      };

      expect(typeof runner.run).toBe('function');
      expect(typeof runner.dispose).toBe('function');
    });

    it('PipelineRunner.preload is optional', () => {
      const runner: PipelineRunner = {
        run: async (_input, _opts) => ({
          output: makeImageDataLike(),
          resolvedMode: 'photo',
          durationMs: 0,
          stageTimings: { watermark: 0, rmbg: 0, inpaint: 0, finalize: 0 },
          watermarkRemoved: false,
          watermarkMask: null,
          workingPixels: new Uint8ClampedArray(4),
          workingAlpha: new Uint8Array(1),
          nukedPct: 0,
          contentType: 'PHOTO',
        }),
        dispose: async () => undefined,
      };

      expect(runner.preload).toBeUndefined();
    });
  });
});
