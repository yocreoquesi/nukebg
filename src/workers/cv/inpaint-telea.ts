/**
 * Inpainting Telea - Algoritmo Fast Marching Method para reconstruir
 * zonas enmascaradas usando pixeles vecinos.
 *
 * Port a TypeScript del algoritmo de A. Telea (2004):
 * "An Image Inpainting Technique Based on the Fast Marching Method"
 * Basado en la implementacion de antimatter15/inpaint.js (port de scikit-image).
 *
 * Ideal para watermarks porque las regiones son pequenas y el algoritmo
 * propaga la informacion de los bordes hacia adentro de forma natural.
 */

import { INPAINT_PARAMS } from '../../pipeline/constants';

// --- Min-Heap para Fast Marching ---

/** Entrada del heap: [distancia, indice_lineal] */
type HeapEntry = [number, number];

class MinHeap {
  private data: HeapEntry[] = [];

  get length(): number {
    return this.data.length;
  }

  push(entry: HeapEntry): void {
    this.data.push(entry);
    let pos = this.data.length - 1;
    while (pos > 0) {
      const parent = (pos - 1) >>> 1;
      if (this.data[pos][0] < this.data[parent][0]) {
        const tmp = this.data[parent];
        this.data[parent] = this.data[pos];
        this.data[pos] = tmp;
        pos = parent;
      } else {
        break;
      }
    }
  }

  pop(): HeapEntry {
    const ret = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      let pos = 0;
      const end = this.data.length - 1;
      for (;;) {
        const left = (pos << 1) + 1;
        const right = left + 1;
        let min = pos;
        if (left <= end && this.data[left][0] < this.data[min][0]) min = left;
        if (right <= end && this.data[right][0] < this.data[min][0]) min = right;
        if (min !== pos) {
          const tmp = this.data[min];
          this.data[min] = this.data[pos];
          this.data[pos] = tmp;
          pos = min;
        } else {
          break;
        }
      }
    }
    return ret;
  }
}

// --- Constantes FMM ---
const KNOWN = 0;
const BAND = 1;
const UNKNOWN = 2;
const LARGE_VALUE = 1e6;
const SMALL_VALUE = 1e-6;

/**
 * Inpainting Telea para una imagen RGBA.
 * Procesa cada canal (R, G, B) por separado con el mismo FMM.
 * El canal alpha se mantiene opaco en la zona inpaintada.
 *
 * @param pixels - Pixeles RGBA de la imagen original
 * @param width - Ancho de la imagen
 * @param height - Alto de la imagen
 * @param mask - Mascara binaria (1 = zona a reconstruir, 0 = zona conocida)
 * @param radius - Radio de busqueda de vecinos (default: INPAINT_PARAMS.TELEA_RADIUS)
 * @returns Nueva copia de pixeles RGBA con la zona reconstruida
 */
export function inpaintTelea(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  radius?: number,
): Uint8ClampedArray {
  const r = radius ?? INPAINT_PARAMS.TELEA_RADIUS;
  const size = width * height;
  const result = new Uint8ClampedArray(pixels);

  // Extraer canales separados como Float32Array para precision
  const channels: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      ch[i] = pixels[i * 4 + c];
    }
    channels.push(ch);
  }

  // Computar flag array y distance array (compartido entre canales)
  const flag = new Uint8Array(size);
  const u = new Float32Array(size);

  // Paso 1: dilatacion morfologica de la mascara para encontrar la banda
  const dilated = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!mask[i]) continue;
    dilated[i] = 1;
    // Cruz de 1px
    if (i > 0) dilated[i - 1] = 1;
    if (i < size - 1) dilated[i + 1] = 1;
    if (i >= width) dilated[i - width] = 1;
    if (i + width < size) dilated[i + width] = 1;
  }

  // Paso 2: clasificar pixeles
  for (let i = 0; i < size; i++) {
    if (mask[i]) {
      // Pixel desconocido que esta en la banda dilatada
      if (dilated[i] && !mask[i]) {
        flag[i] = BAND;
      } else {
        flag[i] = UNKNOWN;
        u[i] = LARGE_VALUE;
      }
    } else if (dilated[i]) {
      // Pixel conocido en el borde de la mascara = BAND
      flag[i] = BAND;
    } else {
      flag[i] = KNOWN;
    }
  }

  // Re-check: los pixeles de mask que estan en la frontera (vecino conocido) son BAND
  // pero los que estan dentro son UNKNOWN
  // Simplificacion: flag = dilated*2 - (mask XOR dilated)
  for (let i = 0; i < size; i++) {
    const inMask = mask[i] ? 1 : 0;
    const inDilated = dilated[i] ? 1 : 0;
    flag[i] = (inDilated * 2) - (inMask ^ inDilated);
    if (flag[i] === UNKNOWN) {
      u[i] = LARGE_VALUE;
    }
  }

  // Paso 3: inicializar heap con todos los pixeles BAND
  const heap = new MinHeap();
  for (let i = 0; i < size; i++) {
    if (flag[i] === BAND) {
      heap.push([u[i], i]);
    }
  }

  // Paso 4: precomputar offsets circulares para el radio dado
  const offsets: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    const h = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let dx = -h; dx <= h; dx++) {
      offsets.push(dx + dy * width);
    }
  }

  // Funciones auxiliares del FMM
  function eikonal(n1: number, n2: number): number {
    let uOut = LARGE_VALUE;
    const u1 = u[n1];
    const u2 = u[n2];
    if (flag[n1] === KNOWN) {
      if (flag[n2] === KNOWN) {
        const diff = u1 - u2;
        const perp = Math.sqrt(Math.max(0, 2 - diff * diff));
        let s = (u1 + u2 - perp) * 0.5;
        if (s >= u1 && s >= u2) {
          uOut = s;
        } else {
          s += perp;
          if (s >= u1 && s >= u2) {
            uOut = s;
          }
        }
      } else {
        uOut = 1 + u1;
      }
    } else if (flag[n2] === KNOWN) {
      uOut = 1 + u2;
    }
    return uOut;
  }

  function gradFunc(array: Float32Array, n: number, step: number): number {
    if (flag[n + step] !== UNKNOWN) {
      if (flag[n - step] !== UNKNOWN) {
        return (array[n + step] - array[n - step]) * 0.5;
      }
      return array[n + step] - array[n];
    }
    if (flag[n - step] !== UNKNOWN) {
      return array[n] - array[n - step];
    }
    return 0;
  }

  function inpaintPoint(n: number, channel: Float32Array): void {
    let Ia = 0;
    let norm = 0;
    const gradxU = gradFunc(u, n, 1);
    const gradyU = gradFunc(u, n, width);
    const ix = n % width;
    const iy = Math.floor(n / width);

    for (let k = 0; k < offsets.length; k++) {
      const nb = n + offsets[k];
      if (nb < 0 || nb >= size) continue;

      const nbx = nb % width;
      const nby = Math.floor(nb / width);

      // Bordes de seguridad
      if (nbx <= 1 || nby <= 1 || nbx >= width - 1 || nby >= height - 1) continue;
      if (flag[nb] !== KNOWN) continue;

      const rx = ix - nbx;
      const ry = iy - nby;
      const dst2 = rx * rx + ry * ry;

      const geometricDst = 1 / (dst2 * Math.sqrt(dst2));
      const levelsetDst = 1 / (1 + Math.abs(u[nb] - u[n]));
      const direction = Math.abs(rx * gradxU + ry * gradyU);
      const weight = geometricDst * levelsetDst * direction + SMALL_VALUE;

      Ia += weight * channel[nb];
      norm += weight;
    }

    channel[n] = Ia / norm;
  }

  // Paso 5: Fast Marching - procesar todos los canales simultaneamente
  // Clonar el heap state para poder reusar (procesamos 3 canales con el mismo FMM)
  // Estrategia: procesar los 3 canales en un solo FMM pass
  while (heap.length) {
    const entry = heap.pop();
    const n = entry[1];
    const ix = n % width;
    const iy = Math.floor(n / width);

    flag[n] = KNOWN;

    if (ix <= 1 || iy <= 1 || ix >= width - 1 || iy >= height - 1) continue;

    // Vecinos cardinales
    const neighbors = [n - width, n - 1, n + width, n + 1];
    for (let k = 0; k < 4; k++) {
      const nb = neighbors[k];
      if (nb < 0 || nb >= size) continue;
      if (flag[nb] === KNOWN) continue;

      u[nb] = Math.min(
        eikonal(nb - width, nb - 1),
        eikonal(nb + width, nb - 1),
        eikonal(nb - width, nb + 1),
        eikonal(nb + width, nb + 1),
      );

      if (flag[nb] === UNKNOWN) {
        flag[nb] = BAND;
        heap.push([u[nb], nb]);
        // Inpaintar los 3 canales en este punto
        for (let c = 0; c < 3; c++) {
          inpaintPoint(nb, channels[c]);
        }
      }
    }
  }

  // Paso 6: escribir canales procesados de vuelta a RGBA
  for (let i = 0; i < size; i++) {
    if (!mask[i]) continue; // Solo tocar pixeles de la mascara
    result[i * 4] = Math.round(Math.max(0, Math.min(255, channels[0][i])));
    result[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, channels[1][i])));
    result[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, channels[2][i])));
    result[i * 4 + 3] = 255; // Opaco
  }

  return result;
}
