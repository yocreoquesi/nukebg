import { describe, it, expect } from 'vitest';
import type { ModelId, BackendConfig } from '../../src/types/worker-messages';
import { MODEL_OPTIONS, BACKEND_WEBGPU, BACKEND_WASM } from '../../src/types/worker-messages';

/**
 * Tests for dual-backend model configuration.
 *
 * NukeBG supports two backends:
 * - WebGPU + BiRefNet-lite (fp16, 115MB, MIT license)
 * - WASM + RMBG-1.4 (q8, 45MB, non-commercial fallback)
 *
 * The worker auto-detects the best backend at runtime.
 */

describe('ModelId parameter', () => {
  it('MODEL_OPTIONS contains both models', () => {
    expect(MODEL_OPTIONS.length).toBe(2);
  });

  it('each MODEL_OPTION has id, label and description', () => {
    for (const opt of MODEL_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });

  it('MODEL_OPTIONS includes BiRefNet-lite as primary', () => {
    const birefnet = MODEL_OPTIONS.find(o => o.id === 'onnx-community/BiRefNet_lite-ONNX');
    expect(birefnet).toBeDefined();
    expect(birefnet!.label).toBe('BiRefNet Lite');
  });

  it('MODEL_OPTIONS includes RMBG-1.4 as fallback', () => {
    const rmbg = MODEL_OPTIONS.find(o => o.id === 'briaai/RMBG-1.4');
    expect(rmbg).toBeDefined();
    expect(rmbg!.label).toBe('RMBG 1.4');
  });

  it('BACKEND_WEBGPU config is correct', () => {
    expect(BACKEND_WEBGPU.modelId).toBe('onnx-community/BiRefNet_lite-ONNX');
    expect(BACKEND_WEBGPU.device).toBe('webgpu');
    expect(BACKEND_WEBGPU.dtype).toBe('fp16');
    expect(BACKEND_WEBGPU.label).toBe('BiRefNet Lite');
  });

  it('BACKEND_WASM config is correct', () => {
    expect(BACKEND_WASM.modelId).toBe('briaai/RMBG-1.4');
    expect(BACKEND_WASM.device).toBe('wasm');
    expect(BACKEND_WASM.dtype).toBe('q8');
    expect(BACKEND_WASM.label).toBe('RMBG 1.4');
  });

  it('ModelId type accepts both model IDs', () => {
    const birefnet: ModelId = 'onnx-community/BiRefNet_lite-ONNX';
    const rmbg: ModelId = 'briaai/RMBG-1.4';
    expect(birefnet).toBeTruthy();
    expect(rmbg).toBeTruthy();
  });

  it('BackendConfig has all required fields', () => {
    const config: BackendConfig = BACKEND_WEBGPU;
    expect(config.modelId).toBeTruthy();
    expect(config.device).toBeTruthy();
    expect(config.dtype).toBeTruthy();
    expect(config.label).toBeTruthy();
  });

  it('modelId conditional generates correct payload for mlCall', () => {
    const modelId: ModelId | undefined = 'briaai/RMBG-1.4';
    const extra = modelId ? { modelId } : undefined;
    expect(extra).toEqual({ modelId: 'briaai/RMBG-1.4' });
  });

  it('modelId undefined generates undefined extra', () => {
    const modelId: ModelId | undefined = undefined;
    const extra = modelId ? { modelId } : undefined;
    expect(extra).toBeUndefined();
  });

  it('segment message builds correctly with modelId', () => {
    const modelId: ModelId = 'onnx-community/BiRefNet_lite-ONNX';
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
    expect(message.modelId).toBe('onnx-community/BiRefNet_lite-ONNX');
    expect(message.payload.pixels).toBeInstanceOf(Uint8ClampedArray);
  });

  it('preloadModel builds correct message without modelId', () => {
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
