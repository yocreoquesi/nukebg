import { detectBgColors } from './cv/detect-bg-colors';
import { detectCheckerGrid } from './cv/detect-checker-grid';
import { gridFloodFill } from './cv/grid-flood-fill';
import { subjectExclusion } from './cv/subject-exclusion';
import { simpleFloodFill } from './cv/simple-flood-fill';
import { watermarkDetect } from './cv/watermark-detect';
import { watermarkDetectDalle } from './cv/watermark-dalle';
import { shadowCleanup } from './cv/shadow-cleanup';
import { alphaRefine } from './cv/alpha-refine';
import type { CvWorkerRequest } from '../types/worker-messages';

self.onmessage = (e: MessageEvent<CvWorkerRequest>) => {
  const { id, type, payload } = e.data;

  try {
    switch (type) {
      case 'detect-bg-colors': {
        const result = detectBgColors(
          payload.pixels, payload.width, payload.height, payload.sampleSize
        );
        self.postMessage({ id, type, result });
        break;
      }
      case 'detect-checker-grid': {
        const result = detectCheckerGrid(
          payload.pixels, payload.width, payload.height,
          payload.colorDark, payload.colorLight
        );
        self.postMessage({ id, type, result });
        break;
      }
      case 'grid-flood-fill': {
        const result = gridFloodFill(
          payload.pixels, payload.width, payload.height,
          payload.colorDark, payload.colorLight,
          payload.gridSize, payload.phase, payload.tolerance
        );
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'subject-exclusion': {
        const result = subjectExclusion(
          payload.pixels, payload.width, payload.height,
          payload.colorDark, payload.colorLight,
          payload.gridSize, payload.phase, payload.tolerance
        );
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'simple-flood-fill': {
        const result = simpleFloodFill(
          payload.pixels, payload.width, payload.height,
          payload.colorA, payload.colorB, payload.tolerance
        );
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'watermark-detect': {
        const result = watermarkDetect(
          payload.pixels, payload.width, payload.height,
          payload.colorA, payload.colorB
        );
        const transferables: Transferable[] = result.mask ? [result.mask.buffer] : [];
        self.postMessage({ id, type, result }, transferables);
        break;
      }
      case 'watermark-detect-dalle': {
        const result = watermarkDetectDalle(
          payload.pixels, payload.width, payload.height
        );
        const transferables: Transferable[] = result.mask ? [result.mask.buffer] : [];
        self.postMessage({ id, type, result }, transferables);
        break;
      }
      case 'shadow-cleanup': {
        const result = shadowCleanup(
          payload.pixels, payload.width, payload.height,
          payload.mask, payload.maxBlobSize
        );
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'alpha-refine': {
        const result = alphaRefine(payload.mask, payload.width, payload.height);
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err) });
  }
};
