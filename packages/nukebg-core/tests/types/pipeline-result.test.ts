import { describe, it, expect } from 'vitest';
import type {
  PipelineResult,
  PipelineStage,
  StageStatus,
  StageEvent,
  ImageContentType,
} from '../../src/types/pipeline-result.js';
import type { ImageDataLike } from '../../src/types/image-data-like.js';
import { createImageDataLike } from '../../src/types/image-data-like.js';

describe('PipelineResult types (REQ-CORE-PIPELINE-6)', () => {
  const makeImageDataLike = (): ImageDataLike =>
    createImageDataLike(new Uint8ClampedArray(4), 1, 1);

  it('output field accepts an ImageDataLike', () => {
    const output = makeImageDataLike();
    const result: PipelineResult = {
      output,
      resolvedMode: 'photo',
      durationMs: 100,
      stageTimings: { watermark: 10, rmbg: 50, inpaint: 20, finalize: 20 },
      watermarkRemoved: false,
      watermarkMask: null,
      workingPixels: new Uint8ClampedArray(4),
      workingAlpha: new Uint8Array(1),
      workingWidth: 1,
      workingHeight: 1,
      nukedPct: 0,
      contentType: 'PHOTO',
    };

    expect(result.output).toBe(output);
  });

  it('resolvedMode must be one of: photo | signature | icon', () => {
    const modes: Array<PipelineResult['resolvedMode']> = ['photo', 'signature', 'icon'];
    for (const mode of modes) {
      const result: PipelineResult = {
        output: makeImageDataLike(),
        resolvedMode: mode,
        durationMs: 10,
        stageTimings: { watermark: 0, rmbg: 10, inpaint: 0, finalize: 0 },
        watermarkRemoved: false,
        watermarkMask: null,
        workingPixels: new Uint8ClampedArray(4),
        workingAlpha: new Uint8Array(1),
        workingWidth: 1,
        workingHeight: 1,
        nukedPct: 0,
        contentType: 'PHOTO',
      };
      expect(['photo', 'signature', 'icon']).toContain(result.resolvedMode);
    }
  });

  it('durationMs is a number (REQ-CORE-PIPELINE-6)', () => {
    const result: PipelineResult = {
      output: makeImageDataLike(),
      resolvedMode: 'photo',
      durationMs: 250.5,
      stageTimings: { watermark: 0, rmbg: 250, inpaint: 0, finalize: 0 },
      watermarkRemoved: false,
      watermarkMask: null,
      workingPixels: new Uint8ClampedArray(4),
      workingAlpha: new Uint8Array(1),
      workingWidth: 1,
      workingHeight: 1,
      nukedPct: 0,
      contentType: 'PHOTO',
    };

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stageTimings contains the four required keys (REQ-CORE-PIPELINE-6)', () => {
    const result: PipelineResult = {
      output: makeImageDataLike(),
      resolvedMode: 'photo',
      durationMs: 100,
      stageTimings: {
        watermark: 10,
        rmbg: 60,
        inpaint: 15,
        finalize: 15,
      },
      watermarkRemoved: false,
      watermarkMask: null,
      workingPixels: new Uint8ClampedArray(4),
      workingAlpha: new Uint8Array(1),
      workingWidth: 1,
      workingHeight: 1,
      nukedPct: 0,
      contentType: 'PHOTO',
    };

    expect(result.stageTimings).toHaveProperty('watermark');
    expect(result.stageTimings).toHaveProperty('rmbg');
    expect(result.stageTimings).toHaveProperty('inpaint');
    expect(result.stageTimings).toHaveProperty('finalize');
    expect(typeof result.stageTimings['watermark']).toBe('number');
    expect(typeof result.stageTimings['rmbg']).toBe('number');
    expect(typeof result.stageTimings['inpaint']).toBe('number');
    expect(typeof result.stageTimings['finalize']).toBe('number');
  });

  it('stageTimings values are non-negative numbers', () => {
    const timings = { watermark: 5.2, rmbg: 80.1, inpaint: 0, finalize: 12.7 };
    const result: PipelineResult = {
      output: makeImageDataLike(),
      resolvedMode: 'signature',
      durationMs: 98,
      stageTimings: timings,
      watermarkRemoved: false,
      watermarkMask: null,
      workingPixels: new Uint8ClampedArray(4),
      workingAlpha: new Uint8Array(1),
      workingWidth: 1,
      workingHeight: 1,
      nukedPct: 50,
      contentType: 'SIGNATURE',
    };

    for (const [key, val] of Object.entries(result.stageTimings)) {
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(0);
      void key;
    }
  });

  describe('PipelineStage type', () => {
    it('accepts valid stage identifiers', () => {
      const stages: PipelineStage[] = [
        'detect-background',
        'ml-segmentation',
        'watermark-scan',
        'inpaint',
      ];
      expect(stages).toHaveLength(4);
    });
  });

  describe('StageStatus type', () => {
    it('accepts valid status values', () => {
      const statuses: StageStatus[] = ['running', 'done', 'skipped', 'error'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('StageEvent interface', () => {
    it('stage and status are required, message is optional', () => {
      const event: StageEvent = { stage: 'ml-segmentation', status: 'running' };
      expect(event.stage).toBe('ml-segmentation');
      expect(event.status).toBe('running');
      expect(event.message).toBeUndefined();
    });

    it('accepts message when provided', () => {
      const event: StageEvent = {
        stage: 'watermark-scan',
        status: 'done',
        message: 'Watermark detected',
      };
      expect(event.message).toBe('Watermark detected');
    });
  });

  describe('ImageContentType type', () => {
    it('accepts PHOTO, SIGNATURE, ICON', () => {
      const types: ImageContentType[] = ['PHOTO', 'SIGNATURE', 'ICON'];
      expect(types).toHaveLength(3);
    });
  });
});
