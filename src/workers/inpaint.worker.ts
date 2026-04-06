/**
 * Inpaint Worker - Watermark zone reconstruction via Telea FMM.
 *
 * Uses the Telea algorithm (Fast Marching Method) to propagate known
 * neighboring pixels inward into the masked zone. Pure CV, no ML model
 * needed, works instantly for small regions like watermarks.
 *
 * Replaces the previous LaMa ONNX implementation that hung on
 * InferenceSession.create() due to a known onnxruntime-web bug with
 * large models in WASM (GitHub issue #26858).
 */
import { inpaintTelea } from './cv/inpaint-telea';
import type { InpaintWorkerRequest, InpaintWorkerResponse } from '../types/worker-messages';

async function inpaint(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): Promise<void> {
  self.postMessage({ id, type: 'inpaint-progress', stage: 'processing' } satisfies InpaintWorkerResponse);

  // Telea FMM: puro CV, sin modelo, sin descarga, instantaneo
  const resultPixels = inpaintTelea(pixels, width, height, mask);

  self.postMessage(
    { id, type: 'inpaint-result', result: resultPixels } satisfies InpaintWorkerResponse,
    [resultPixels.buffer],
  );
}

self.onmessage = async (e: MessageEvent<InpaintWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'inpaint': {
        const { payload } = msg;
        await inpaint(msg.id, payload.pixels, payload.width, payload.height, payload.mask);
        break;
      }
      case 'dispose': {
        // Nothing to free - no model in memory
        self.postMessage({ id: msg.id, type: 'disposed' } satisfies InpaintWorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) } satisfies InpaintWorkerResponse);
  }
};
