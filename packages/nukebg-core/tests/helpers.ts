/**
 * Test helpers: utility functions for generating synthetic images in tests.
 */

/**
 * Creates an RGBA buffer filled with a single color.
 */
export function solidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/**
 * Creates a checkerboard pattern image.
 * colorDark and colorLight are [r, g, b].
 */
export function checkerboardImage(
  width: number,
  height: number,
  gridSize: number,
  colorDark: [number, number, number],
  colorLight: [number, number, number],
  phase = 0,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const cellRow = Math.floor(y / gridSize);
    for (let x = 0; x < width; x++) {
      const cellCol = Math.floor(x / gridSize);
      const parity = (cellRow + cellCol + phase) % 2;
      const color = parity === 0 ? colorDark : colorLight;
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * Paints a solid rectangle onto an existing RGBA buffer.
 */
export function paintRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

/**
 * Counts how many pixels in a Uint8Array are 1 (background).
 */
export function countBg(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) count++;
  }
  return count;
}

/**
 * Counts how many pixels in a Uint8Array are 0 (foreground).
 */
export function countFg(mask: Uint8Array): number {
  return mask.length - countBg(mask);
}
