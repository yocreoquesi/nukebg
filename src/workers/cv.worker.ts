import { detectBgColors } from './cv/detect-bg-colors';
import { watermarkDetect } from './cv/watermark-detect';
import { watermarkDetectDalle } from './cv/watermark-dalle';
import { sparkleDetect } from './cv/sparkle-detect';
import { alphaRefine } from './cv/alpha-refine';
import { extractImageFeatures, classifyImage } from './cv/classify-image';
import { signatureThreshold } from './cv/signature-threshold';
import { estimateForeground } from './cv/foreground-estimation';
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
      case 'sparkle-detect': {
        const result = sparkleDetect(
          payload.pixels, payload.width, payload.height
        );
        const transferables: Transferable[] = result.mask ? [result.mask.buffer] : [];
        self.postMessage({ id, type, result }, transferables);
        break;
      }
      case 'alpha-refine': {
        const result = alphaRefine(payload.mask, payload.width, payload.height);
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'classify-image': {
        const features = extractImageFeatures(payload.pixels, payload.width, payload.height);
        const contentType = classifyImage(features);
        self.postMessage({ id, type, result: { type: contentType, features } });
        break;
      }
      case 'signature-threshold': {
        const result = signatureThreshold(payload.pixels, payload.width, payload.height);
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
      case 'foreground-estimate': {
        const result = estimateForeground(
          payload.pixels, payload.alpha, payload.width, payload.height,
          { iterationsPerLevel: payload.iterationsPerLevel, lambda: payload.lambda },
        );
        self.postMessage({ id, type, result }, [result.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err) });
  }
};
