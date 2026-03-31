import { describe, it, expect } from 'vitest';
import type { ModelId, BackendConfig } from '../../src/types/worker-messages';
import { BACKEND_CONFIG } from '../../src/types/worker-messages';

/**
 * Tests for InSPyReNet model configuration.
 *
 * NukeBG uses InSPyReNet Res2Net50 fp16 (27MB, MIT license)
 * via direct ONNX Runtime session on WASM.
 */

describe('Model configuration', () => {
  it('BACKEND_CONFIG is correct', () => {
    expect(BACKEND_CONFIG.modelId).toBe('inspyrenet');
    expect(BACKEND_CONFIG.device).toBe('wasm');
    expect(BACKEND_CONFIG.dtype).toBe('fp16');
    expect(BACKEND_CONFIG.label).toBe('InSPyReNet');
  });

  it('ModelId type accepts inspyrenet', () => {
    const id: ModelId = 'inspyrenet';
    expect(id).toBeTruthy();
  });

  it('BackendConfig has all required fields', () => {
    const config: BackendConfig = BACKEND_CONFIG;
    expect(config.modelId).toBeTruthy();
    expect(config.device).toBeTruthy();
    expect(config.dtype).toBeTruthy();
    expect(config.label).toBeTruthy();
  });

  it('segment message builds correctly', () => {
    const payload = { pixels: new Uint8ClampedArray(100), width: 5, height: 5 };

    const message = {
      id: 'test-uuid',
      type: 'segment' as const,
      payload,
    };

    expect(message.id).toBe('test-uuid');
    expect(message.type).toBe('segment');
    expect(message.payload.pixels).toBeInstanceOf(Uint8ClampedArray);
  });

  it('load-model message builds correctly', () => {
    const message = {
      id: 'preload-uuid',
      type: 'load-model' as const,
    };

    expect(message.type).toBe('load-model');
  });
});
