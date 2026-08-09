import { ALPHA_PARAMS } from '../../pipeline/constants';

/**
 * Refine alpha channel: median filter + gaussian blur + threshold.
 * Port of Python alpha refinement steps.
 */
export function alphaRefine(mask: Uint8Array, width: number, height: number): Uint8Array {
  // Convert mask (1=bg, 0=fg) to alpha (0=bg, 255=fg)
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    alpha[i] = mask[i] ? 0 : 255;
  }

  // Step 1: Median filter 3x3
  const afterMedian = medianFilter(alpha, width, height, ALPHA_PARAMS.MEDIAN_KERNEL);

  // Step 2: Gaussian blur (sigma=0.8)
  const afterGauss = gaussianBlur(afterMedian, width, height, ALPHA_PARAMS.GAUSSIAN_SIGMA);

  // Step 3: Multiply by 2 and clamp (like np.clip(alpha_arr * 2, 0, 255))
  for (let i = 0; i < afterGauss.length; i++) {
    afterGauss[i] = Math.min(afterGauss[i] * 2, 255);
  }

  // Step 4: Threshold
  for (let i = 0; i < afterGauss.length; i++) {
    if (afterGauss[i] > ALPHA_PARAMS.THRESHOLD_HIGH) {
      afterGauss[i] = 255;
    } else if (afterGauss[i] < ALPHA_PARAMS.THRESHOLD_LOW) {
      afterGauss[i] = 0;
    }
  }

  return afterGauss;
}

/** 3x3 median filter */
function medianFilter(data: Uint8Array, width: number, height: number, kernel: number): Uint8Array {
  const result = new Uint8Array(data.length);
  const half = Math.floor(kernel / 2);
  const values: number[] = new Array(kernel * kernel);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const ny = Math.min(Math.max(y + ky, 0), height - 1);
          const nx = Math.min(Math.max(x + kx, 0), width - 1);
          values[count++] = data[ny * width + nx];
        }
      }
      // Sort the neighborhood values and pick median
      const slice = values.slice(0, count);
      slice.sort((a, b) => a - b);
      result[y * width + x] = slice[Math.floor(count / 2)];
    }
  }

  return result;
}

/** Gaussian blur with given sigma using 3x3 kernel */
function gaussianBlur(data: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const result = new Uint8Array(data.length);

  // Pre-compute 3x3 Gaussian kernel for sigma=0.8
  // Using formula: G(x,y) = exp(-(x^2+y^2)/(2*sigma^2))
  const kernel: number[] = [];
  let sum = 0;
  for (let ky = -1; ky <= 1; ky++) {
    for (let kx = -1; kx <= 1; kx++) {
      const v = Math.exp(-(kx * kx + ky * ky) / (2 * sigma * sigma));
      kernel.push(v);
      sum += v;
    }
  }
  // Normalize
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = Math.min(Math.max(y + ky, 0), height - 1);
          const nx = Math.min(Math.max(x + kx, 0), width - 1);
          val += data[ny * width + nx] * kernel[ki++];
        }
      }
      result[y * width + x] = Math.round(val);
    }
  }

  return result;
}
