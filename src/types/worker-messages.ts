import type { BgColorResult, GridResult, WatermarkResult } from './pipeline';

/** ======== CV Worker Messages ======== */

export type CvWorkerRequest =
  | CvDetectBgColorsRequest
  | CvDetectCheckerGridRequest
  | CvGridFloodFillRequest
  | CvSubjectExclusionRequest
  | CvSimpleFloodFillRequest
  | CvWatermarkDetectRequest
  | CvWatermarkDetectDalleRequest
  | CvShadowCleanupRequest
  | CvAlphaRefineRequest;

interface CvBaseRequest {
  id: string;
}

export interface CvDetectBgColorsRequest extends CvBaseRequest {
  type: 'detect-bg-colors';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    sampleSize?: number;
  };
}

export interface CvDetectCheckerGridRequest extends CvBaseRequest {
  type: 'detect-checker-grid';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    colorDark: number[];
    colorLight: number[];
  };
}

export interface CvGridFloodFillRequest extends CvBaseRequest {
  type: 'grid-flood-fill';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    colorDark: number[];
    colorLight: number[];
    gridSize: number;
    phase: number;
    tolerance?: number;
  };
}

export interface CvSubjectExclusionRequest extends CvBaseRequest {
  type: 'subject-exclusion';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    colorDark: number[];
    colorLight: number[];
    gridSize: number;
    phase: number;
    tolerance?: number;
  };
}

export interface CvSimpleFloodFillRequest extends CvBaseRequest {
  type: 'simple-flood-fill';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    colorA: number[];
    colorB: number[];
    tolerance?: number;
  };
}

export interface CvWatermarkDetectRequest extends CvBaseRequest {
  type: 'watermark-detect';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    colorA: number[];
    colorB: number[];
  };
}

export interface CvWatermarkDetectDalleRequest extends CvBaseRequest {
  type: 'watermark-detect-dalle';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
  };
}

export interface CvShadowCleanupRequest extends CvBaseRequest {
  type: 'shadow-cleanup';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    mask: Uint8Array;
    maxBlobSize?: number;
  };
}

export interface CvAlphaRefineRequest extends CvBaseRequest {
  type: 'alpha-refine';
  payload: {
    mask: Uint8Array;
    width: number;
    height: number;
  };
}

/** CV Worker response */
export type CvWorkerResponse =
  | { id: string; type: 'detect-bg-colors'; result: BgColorResult }
  | { id: string; type: 'detect-checker-grid'; result: GridResult }
  | { id: string; type: 'grid-flood-fill'; result: Uint8Array }
  | { id: string; type: 'subject-exclusion'; result: Uint8Array }
  | { id: string; type: 'simple-flood-fill'; result: Uint8Array }
  | { id: string; type: 'watermark-detect'; result: WatermarkResult }
  | { id: string; type: 'watermark-detect-dalle'; result: WatermarkResult }
  | { id: string; type: 'shadow-cleanup'; result: Uint8Array }
  | { id: string; type: 'alpha-refine'; result: Uint8Array }
  | { id: string; type: 'error'; error: string };


/** ======== ML Worker Messages ======== */

export type ModelId = 'briaai/RMBG-1.4';

export const MODEL_OPTIONS: { id: ModelId; label: string; description: string }[] = [
  { id: 'briaai/RMBG-1.4', label: 'RMBG 1.4', description: 'Best for illustrations, icons, and AI art' },
];

export type MlWorkerRequest =
  | MlLoadModelRequest
  | MlSegmentRequest;

export interface MlLoadModelRequest {
  id: string;
  type: 'load-model';
  modelId?: ModelId;
}

export interface MlSegmentRequest {
  id: string;
  type: 'segment';
  modelId?: ModelId;
  threshold?: number;
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
  };
}

export type MlWorkerResponse =
  | { id: string; type: 'model-progress'; progress: number }
  | { id: string; type: 'model-ready'; device: 'webgpu' | 'wasm' }
  | { id: string; type: 'segment-result'; result: Uint8Array }
  | { id: string; type: 'error'; error: string };


/** ======== Inpaint Worker Messages ======== */

export type InpaintWorkerRequest =
  | InpaintRunRequest
  | InpaintDisposeRequest;

export interface InpaintRunRequest {
  id: string;
  type: 'inpaint';
  payload: {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    mask: Uint8Array;
  };
}

export interface InpaintDisposeRequest {
  id: string;
  type: 'dispose';
}

export type InpaintWorkerResponse =
  | { id: string; type: 'inpaint-progress'; stage: string }
  | { id: string; type: 'inpaint-result'; result: Uint8ClampedArray }
  | { id: string; type: 'disposed' }
  | { id: string; type: 'error'; error: string };
