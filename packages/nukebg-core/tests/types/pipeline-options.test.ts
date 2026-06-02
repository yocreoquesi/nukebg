import { describe, it, expect } from 'vitest';
import type {
  PipelineMode,
  PipelinePrecision,
  PipelineOptions,
} from '../../src/types/pipeline-options.js';

describe('PipelineOptions types', () => {
  describe('PipelineMode', () => {
    it('accepts "photo" as a valid mode', () => {
      const mode: PipelineMode = 'photo';
      expect(mode).toBe('photo');
    });

    it('accepts "signature" as a valid mode', () => {
      const mode: PipelineMode = 'signature';
      expect(mode).toBe('signature');
    });

    it('accepts "icon" as a valid mode', () => {
      const mode: PipelineMode = 'icon';
      expect(mode).toBe('icon');
    });

    it('accepts "auto" as a valid mode', () => {
      const mode: PipelineMode = 'auto';
      expect(mode).toBe('auto');
    });
  });

  describe('PipelinePrecision', () => {
    it('accepts "low" as a valid precision', () => {
      const precision: PipelinePrecision = 'low';
      expect(precision).toBe('low');
    });

    it('accepts "normal" as a valid precision', () => {
      const precision: PipelinePrecision = 'normal';
      expect(precision).toBe('normal');
    });

    it('accepts "high" as a valid precision', () => {
      const precision: PipelinePrecision = 'high';
      expect(precision).toBe('high');
    });

    it('accepts "ultra" as a valid precision', () => {
      const precision: PipelinePrecision = 'ultra';
      expect(precision).toBe('ultra');
    });
  });

  describe('PipelineOptions', () => {
    it('all fields are optional — empty object is valid', () => {
      const opts: PipelineOptions = {};
      expect(opts).toBeDefined();
    });

    it('accepts mode field', () => {
      const opts: PipelineOptions = { mode: 'photo' };
      expect(opts.mode).toBe('photo');
    });

    it('accepts precision field', () => {
      const opts: PipelineOptions = { precision: 'high' };
      expect(opts.precision).toBe('high');
    });

    it('accepts skipWatermark field', () => {
      const opts: PipelineOptions = { skipWatermark: true };
      expect(opts.skipWatermark).toBe(true);
    });

    it('accepts signal field', () => {
      const controller = new AbortController();
      const opts: PipelineOptions = { signal: controller.signal };
      expect(opts.signal).toBe(controller.signal);
    });

    it('accepts onStage callback field', () => {
      const handler = () => undefined;
      const opts: PipelineOptions = { onStage: handler };
      expect(opts.onStage).toBe(handler);
    });

    it('accepts all fields together', () => {
      const controller = new AbortController();
      const opts: PipelineOptions = {
        mode: 'auto',
        precision: 'normal',
        skipWatermark: false,
        signal: controller.signal,
        onStage: () => undefined,
      };
      expect(opts.mode).toBe('auto');
      expect(opts.precision).toBe('normal');
      expect(opts.skipWatermark).toBe(false);
    });
  });
});
