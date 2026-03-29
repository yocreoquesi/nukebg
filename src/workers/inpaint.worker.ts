/**
 * Inpaint Worker - Reconstruccion de zonas de watermark via Telea FMM.
 *
 * Usa el algoritmo de Telea (Fast Marching Method) que propaga pixeles
 * vecinos conocidos hacia adentro de la zona enmascarada. Es puro CV,
 * no necesita modelo ML, y funciona instantaneamente para regiones
 * pequenas como watermarks.
 *
 * Reemplaza la implementacion anterior basada en LaMa ONNX que colgaba
 * en InferenceSession.create() por bug conocido de onnxruntime-web con
 * modelos grandes en WASM (GitHub issue #26858).
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
        // Nada que liberar - no hay modelo en memoria
        self.postMessage({ id: msg.id, type: 'disposed' } satisfies InpaintWorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) } satisfies InpaintWorkerResponse);
  }
};
