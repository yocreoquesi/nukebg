/**
 * Inpaint Worker — Watermark zone reconstruction via PatchMatch.
 *
 * PatchMatch (Barnes et al. 2009) reconstructs the masked zone by finding,
 * for every target patch, its nearest neighbor in the rest of the image and
 * voting from those sources. Unlike Telea FMM it produces no radial streaks
 * and preserves local texture across the fill. Pure CV, no model needed.
 */
import { patchMatchInpaint } from './cv/patchmatch-inpaint';
import type { InpaintWorkerRequest, InpaintWorkerResponse } from '../types/worker-messages';
import { PATCHMATCH_PARAMS } from '../pipeline/constants';

async function inpaint(
  id: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
): Promise<void> {
  self.postMessage({
    id,
    type: 'inpaint-progress',
    stage: 'processing',
  } satisfies InpaintWorkerResponse);

  const resultPixels = patchMatchInpaint(pixels, width, height, mask, {
    iterations: PATCHMATCH_PARAMS.ITERATIONS,
    patchRadius: PATCHMATCH_PARAMS.PATCH_RADIUS,
  });

  self.postMessage(
    { id, type: 'inpaint-result', result: resultPixels } satisfies InpaintWorkerResponse,
    [resultPixels.buffer],
  );
}

self.onmessage = async (e: MessageEvent<InpaintWorkerRequest>) => {
  // Reject cross-origin postMessage (CodeQL js/missing-origin-check, #187).
  // Empty-origin events are allowed: dedicated Workers receive '' in some
  // browsers; same-origin spawning is enforced by the page's CSP.
  if (e.origin && e.origin !== self.location.origin) return;
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
    self.postMessage({
      id: msg.id,
      type: 'error',
      error: String(err),
    } satisfies InpaintWorkerResponse);
  }
};
