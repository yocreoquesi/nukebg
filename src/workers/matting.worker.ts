/**
 * Matting Worker — ViTMatte alpha matting via Transformers.js
 * Refines edges of an existing mask using the original image.
 * Pipeline: original image + trimap (from RMBG mask) → refined alpha
 */

let mattingModel: unknown = null;
let processor: unknown = null;
let RawImageClass: unknown = null;

const MODEL_ID = 'Xenova/vitmatte-small-composition-1k';

/**
 * Generate trimap from binary mask.
 * White (255) = definite foreground
 * Black (0) = definite background
 * Gray (128) = unknown edge region to refine
 */
function generateTrimap(
  mask: Uint8Array,
  width: number,
  height: number,
  edgeWidth: number = 10,
): Uint8ClampedArray {
  const trimap = new Uint8ClampedArray(width * height);

  // First pass: set fg/bg
  for (let i = 0; i < mask.length; i++) {
    trimap[i] = mask[i] > 200 ? 255 : 0;
  }

  // Second pass: dilate foreground to find edge region
  const temp = new Uint8ClampedArray(trimap);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (temp[idx] === 255 || temp[idx] === 0) {
        // Check if near the boundary
        let nearEdge = false;
        for (let dy = -edgeWidth; dy <= edgeWidth && !nearEdge; dy++) {
          for (let dx = -edgeWidth; dx <= edgeWidth && !nearEdge; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (temp[nIdx] !== temp[idx]) {
              nearEdge = true;
            }
          }
        }
        if (nearEdge) {
          trimap[idx] = 128;
        }
      }
    }
  }

  return trimap;
}

async function loadModel(id: string): Promise<void> {
  if (mattingModel) {
    self.postMessage({ id, type: 'matting-progress', stage: 'ready' });
    return;
  }

  self.postMessage({ id, type: 'matting-progress', stage: 'loading' });

  const transformers = await import('@huggingface/transformers');
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  RawImageClass = transformers.RawImage;

  // Load model and processor
  mattingModel = await transformers.AutoModel.from_pretrained(MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (progress: { status: string; progress?: number }) => {
      if (progress.status === 'progress' && progress.progress != null) {
        self.postMessage({ id, type: 'matting-progress', stage: `downloading-${Math.round(progress.progress)}` });
      }
    },
  });
  processor = await transformers.AutoProcessor.from_pretrained(MODEL_ID);

  self.postMessage({ id, type: 'matting-progress', stage: 'ready' });
}

async function refineAlpha(
  id: string,
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
): Promise<void> {
  if (!mattingModel || !processor || !RawImageClass) {
    await loadModel(id);
  }

  self.postMessage({ id, type: 'matting-progress', stage: 'generating-trimap' });

  // Generate trimap from the RMBG mask
  const trimap = generateTrimap(mask, width, height, 10);

  self.postMessage({ id, type: 'matting-progress', stage: 'refining' });

  // Create RawImage objects
  const RImg = RawImageClass as { new(data: Uint8ClampedArray, w: number, h: number, ch: number): unknown };

  // Image needs to be RGB (3 channels)
  const rgbPixels = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgbPixels[i * 3] = pixels[i * 4];
    rgbPixels[i * 3 + 1] = pixels[i * 4 + 1];
    rgbPixels[i * 3 + 2] = pixels[i * 4 + 2];
  }

  const image = new RImg(rgbPixels, width, height, 3);

  // Trimap needs to be single channel
  const trimapImg = new RImg(trimap, width, height, 1);

  // Run processor and model
  const proc = processor as { (images: unknown, trimaps: unknown): Promise<{ pixel_values: unknown }> };
  const inputs = await proc(image, trimapImg);

  const model = mattingModel as { (input: { pixel_values: unknown }): Promise<{ alphas: { data: Float32Array; dims: number[] } }> };
  const output = await model({ pixel_values: inputs.pixel_values });

  // Extract alpha and scale to 0-255
  const alphaData = output.alphas.data;
  const alphaDims = output.alphas.dims;
  const outH = alphaDims[2] || height;
  const outW = alphaDims[3] || width;

  const result = new Uint8Array(width * height);
  const scaleX = outW / width;
  const scaleY = outH / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), outW - 1);
      const srcY = Math.min(Math.floor(y * scaleY), outH - 1);
      const val = alphaData[srcY * outW + srcX];
      result[y * width + x] = Math.round(Math.max(0, Math.min(255, val * 255)));
    }
  }

  self.postMessage(
    { id, type: 'matting-result', result },
    [result.buffer],
  );
}

function dispose(): void {
  mattingModel = null;
  processor = null;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'refine': {
        const { pixels, mask, width, height } = msg.payload;
        await refineAlpha(msg.id, pixels, mask, width, height);
        break;
      }
      case 'dispose': {
        dispose();
        self.postMessage({ id: msg.id, type: 'disposed' });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', error: String(err) });
  }
};
