/**
 * SAM Worker - Mask refinement via SlimSAM / Transformers.js
 * Used as an experimental secondary pass after RMBG-1.4.
 * Receives the original image + RMBG's rough mask,
 * feeds the mask as a dense prompt to SAM for edge refinement.
 */

export type SamWorkerRequest =
  | { id: string; type: 'load-model' }
  | { id: string; type: 'refine'; payload: { pixels: Uint8ClampedArray; mask: Uint8Array; width: number; height: number } };

export type SamWorkerResponse =
  | { id: string; type: 'sam-progress'; progress: number }
  | { id: string; type: 'sam-ready' }
  | { id: string; type: 'refine-result'; result: Uint8Array }
  | { id: string; type: 'error'; error: string };

const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform';

/** Cached model + processor */
let samModel: unknown = null;
let samProcessor: unknown = null;
let RawImageClass: (new (data: Uint8ClampedArray, w: number, h: number, channels: number) => unknown) | null = null;

async function loadModel(id: string): Promise<void> {
  if (samModel && samProcessor) {
    self.postMessage({ id, type: 'sam-progress', progress: 100 } satisfies SamWorkerResponse);
    self.postMessage({ id, type: 'sam-ready' } satisfies SamWorkerResponse);
    return;
  }

  self.postMessage({ id, type: 'sam-progress', progress: 5 } satisfies SamWorkerResponse);

  const transformers = await import('@huggingface/transformers');
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  RawImageClass = transformers.RawImage as unknown as typeof RawImageClass;

  self.postMessage({ id, type: 'sam-progress', progress: 15 } satisfies SamWorkerResponse);

  // Load SAM model
  samModel = await transformers.SamModel.from_pretrained(SAM_MODEL_ID, {
    dtype: 'fp32',
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress' && p.progress != null) {
        const pct = 15 + Math.round(p.progress * 0.7);
        self.postMessage({ id, type: 'sam-progress', progress: pct } satisfies SamWorkerResponse);
      }
    },
  });

  self.postMessage({ id, type: 'sam-progress', progress: 90 } satisfies SamWorkerResponse);

  // Load processor
  samProcessor = await transformers.AutoProcessor.from_pretrained(SAM_MODEL_ID);

  self.postMessage({ id, type: 'sam-progress', progress: 100 } satisfies SamWorkerResponse);
  self.postMessage({ id, type: 'sam-ready' } satisfies SamWorkerResponse);
}

async function refine(
  id: string,
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
): Promise<void> {
  if (!samModel || !samProcessor || !RawImageClass) {
    await loadModel(`_autoload_${id}`);
  }

  const model = samModel as { (inputs: Record<string, unknown>): Promise<{ pred_masks: unknown; iou_scores: { data: Float32Array } }> };
  const processor = samProcessor as {
    (image: unknown, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
    post_process_masks(masks: unknown, originalSizes: unknown, reshapedInputSizes: unknown, options?: Record<string, unknown>): Promise<unknown[]>;
  };

  // Create RawImage from pixels
  const image = new RawImageClass!(pixels, width, height, 4);

  // Convert RMBG mask to point prompts for SAM
  // Find centroid + bounding box of foreground
  let sumX = 0, sumY = 0, count = 0;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 128) {
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count === 0) {
    self.postMessage(
      { id, type: 'refine-result', result: mask } satisfies SamWorkerResponse,
      [mask.buffer],
    );
    return;
  }

  const centerX = Math.round(sumX / count);
  const centerY = Math.round(sumY / count);

  // input_points must be 4D: [batch_size, point_batch_size, num_points, 2]
  const input_points = [[[[centerX, centerY]]]];
  const input_labels = [[[1]]]; // 1 = positive (foreground)

  // Process with SAM — input_points as named parameter
  const inputs = await processor(image, { input_points, input_labels });
  const outputs = await model(inputs);

  // Post-process masks
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    (inputs as Record<string, unknown>).original_sizes,
    (inputs as Record<string, unknown>).reshaped_input_sizes,
  );

  // masks is an array of Tensors, one per batch item
  const maskTensor = masks[0] as unknown as { data: Float32Array | Uint8Array; dims: number[] };
  if (!maskTensor || !maskTensor.data) {
    self.postMessage(
      { id, type: 'refine-result', result: mask } satisfies SamWorkerResponse,
      [mask.buffer],
    );
    return;
  }

  const maskData = maskTensor.data;
  const resultAlpha = new Uint8Array(width * height);

  // Find best mask index from IoU scores (SAM returns 3 masks)
  const iouData = outputs.iou_scores.data;
  let bestIdx = 0;
  let bestIou = -1;
  for (let i = 0; i < iouData.length; i++) {
    if (iouData[i] > bestIou) {
      bestIou = iouData[i];
      bestIdx = i;
    }
  }

  // Tensor dims: [1, 3, H, W] — extract the best mask plane
  const maskH = maskTensor.dims[maskTensor.dims.length - 2];
  const maskW = maskTensor.dims[maskTensor.dims.length - 1];
  const planeSize = maskW * maskH;
  const planeOffset = bestIdx * planeSize;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * maskW / width), maskW - 1);
      const srcY = Math.min(Math.floor(y * maskH / height), maskH - 1);
      const val = maskData[planeOffset + srcY * maskW + srcX];
      resultAlpha[y * width + x] = val > 0 ? 255 : 0;
    }
  }

  self.postMessage(
    { id, type: 'refine-result', result: resultAlpha } satisfies SamWorkerResponse,
    [resultAlpha.buffer],
  );
}

self.onmessage = async (e: MessageEvent<SamWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load-model':
        await loadModel(msg.id);
        break;
      case 'refine':
        await refine(msg.id, msg.payload.pixels, msg.payload.mask, msg.payload.width, msg.payload.height);
        break;
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) } satisfies SamWorkerResponse);
  }
};
