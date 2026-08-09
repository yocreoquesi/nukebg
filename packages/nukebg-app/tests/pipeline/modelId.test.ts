import { describe, it, expect } from 'vitest';
import type { ModelId } from '../../src/types/worker-messages';
import { MODEL_OPTIONS } from '../../src/types/worker-messages';

/**
 * Tests for the modelId parameter in the pipeline.
 *
 * PipelineOrchestrator passes modelId to the ML worker in preloadModel() and process().
 * Since we can't instantiate real workers in unit tests, we validate:
 * 1. That the ModelId type accepts expected values
 * 2. That the decision logic (modelId ? { modelId } : undefined) works
 * 3. That MODEL_OPTIONS has valid entries
 * 4. That the worker message is built correctly
 */

describe('ModelId parameter', () => {
  it('MODEL_OPTIONS contiene al menos un modelo', () => {
    expect(MODEL_OPTIONS.length).toBeGreaterThan(0);
  });

  it('cada MODEL_OPTION tiene id, label y description', () => {
    for (const opt of MODEL_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });

  it('MODEL_OPTIONS incluye RMBG-1.4', () => {
    const rmbg = MODEL_OPTIONS.find((o) => o.id === 'briaai/RMBG-1.4');
    expect(rmbg).toBeDefined();
    expect(rmbg!.label).toBe('RMBG 1.4');
  });

  it('MODEL_OPTIONS solo contiene RMBG-1.4', () => {
    expect(MODEL_OPTIONS.length).toBe(1);
    expect(MODEL_OPTIONS[0].id).toBe('briaai/RMBG-1.4');
  });

  it('modelId condicional genera el payload correcto para mlCall', () => {
    // Replica of the logic in orchestrator.process():
    // modelId ? { modelId } : undefined
    const modelId: ModelId | undefined = 'briaai/RMBG-1.4';
    const extra = modelId ? { modelId } : undefined;
    expect(extra).toEqual({ modelId: 'briaai/RMBG-1.4' });
  });

  it('modelId undefined genera extra undefined', () => {
    const modelId: ModelId | undefined = undefined;
    const extra = modelId ? { modelId } : undefined;
    expect(extra).toBeUndefined();
  });

  it('el mensaje para ml worker se construye correctamente con modelId', () => {
    const modelId: ModelId = 'briaai/RMBG-1.4';
    const payload = { pixels: new Uint8ClampedArray(100), width: 5, height: 5 };
    const extra = modelId ? { modelId } : undefined;

    // Simula lo que hace mlCall: { id, type, payload, ...extra }
    const message = {
      id: 'test-uuid',
      type: 'segment' as const,
      payload,
      ...extra,
    };

    expect(message.id).toBe('test-uuid');
    expect(message.type).toBe('segment');
    expect(message.modelId).toBe('briaai/RMBG-1.4');
    expect(message.payload.pixels).toBeInstanceOf(Uint8ClampedArray);
  });

  it('el mensaje para ml worker sin modelId no tiene la propiedad', () => {
    const modelId: ModelId | undefined = undefined;
    const payload = { pixels: new Uint8ClampedArray(100), width: 5, height: 5 };
    const extra = modelId ? { modelId } : undefined;

    const message = {
      id: 'test-uuid',
      type: 'segment' as const,
      payload,
      ...extra,
    };

    expect(message.id).toBe('test-uuid');
    expect(message.type).toBe('segment');
    expect('modelId' in message).toBe(false);
  });

  it('preloadModel construye mensaje correcto con modelId', () => {
    const modelId: ModelId = 'briaai/RMBG-1.4';
    const extra = modelId ? { modelId } : undefined;

    // Simula: mlCall('load-model', undefined, extra)
    const message = {
      id: 'preload-uuid',
      type: 'load-model' as const,
      payload: undefined,
      ...extra,
    };

    expect(message.type).toBe('load-model');
    expect(message.modelId).toBe('briaai/RMBG-1.4');
    expect(message.payload).toBeUndefined();
  });

  it('preloadModel sin modelId envia mensaje sin modelId', () => {
    const modelId: ModelId | undefined = undefined;
    const extra = modelId ? { modelId } : undefined;

    const message = {
      id: 'preload-uuid',
      type: 'load-model' as const,
      payload: undefined,
      ...extra,
    };

    expect(message.type).toBe('load-model');
    expect('modelId' in message).toBe(false);
  });
});
