/**
 * Integration tests for Telea FMM inpainting.
 *
 * Validates that the CV inpainting algorithm works correctly:
 * - Reconstructs masked regions using neighboring pixels
 * - Does not modify pixels outside the mask
 * - Produces valid RGBA values
 * - Works with typical watermark masks (small, in corners)
 */
import { describe, it, expect } from 'vitest';
import { inpaintTelea } from '../../src/workers/cv/inpaint-telea';

/** Crear imagen sintetica de un solo color */
function solidImage(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/** Crear imagen con gradiente horizontal */
function gradientImage(w: number, h: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = Math.round((x / (w - 1)) * 255);
      pixels[i * 4] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    }
  }
  return pixels;
}

describe('Inpaint Telea FMM', () => {
  it('no modifica pixeles fuera de la mascara', () => {
    const w = 64,
      h = 64;
    const pixels = solidImage(w, h, 128, 64, 32);
    const mask = new Uint8Array(w * h); // Mascara vacia: nada que reconstruir

    const result = inpaintTelea(pixels, w, h, mask);

    // Cada pixel debe ser identico al original
    for (let i = 0; i < w * h * 4; i++) {
      expect(result[i]).toBe(pixels[i]);
    }
  });

  it('reconstruye una zona pequena en imagen solida', () => {
    const w = 64,
      h = 64;
    const pixels = solidImage(w, h, 200, 100, 50);

    // Corrupt a 4x4 block in the center
    const cx = 32,
      cy = 32;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const i = (cy + dy) * w + (cx + dx);
        pixels[i * 4] = 0;
        pixels[i * 4 + 1] = 255;
        pixels[i * 4 + 2] = 0;
      }
    }

    // Mascara cubre el bloque corrupto
    const mask = new Uint8Array(w * h);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        mask[(cy + dy) * w + (cx + dx)] = 1;
      }
    }

    const result = inpaintTelea(pixels, w, h, mask);

    // Los pixeles reconstruidos deben estar cerca del color original (200, 100, 50)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const i = (cy + dy) * w + (cx + dx);
        expect(result[i * 4]).toBeGreaterThan(150); // R ~200
        expect(result[i * 4]).toBeLessThan(255);
        expect(result[i * 4 + 1]).toBeGreaterThan(50); // G ~100
        expect(result[i * 4 + 1]).toBeLessThan(150);
        expect(result[i * 4 + 2]).toBeGreaterThan(10); // B ~50
        expect(result[i * 4 + 2]).toBeLessThan(100);
        expect(result[i * 4 + 3]).toBe(255); // Alpha opaco
      }
    }
  });

  it('produce valores RGBA en rango [0, 255]', () => {
    const w = 64,
      h = 64;
    const pixels = gradientImage(w, h);

    // Mascara diagonal
    const mask = new Uint8Array(w * h);
    for (let i = 10; i < 54; i++) {
      mask[i * w + i] = 1;
      if (i + 1 < w) mask[i * w + i + 1] = 1;
    }

    const result = inpaintTelea(pixels, w, h, mask);

    for (let i = 0; i < w * h * 4; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(255);
    }
  });

  it('funciona con mascara en esquina inferior derecha (watermark tipico)', () => {
    const w = 128,
      h = 128;
    const pixels = solidImage(w, h, 180, 180, 180);

    // Simular watermark en esquina inferior derecha: bloque de 20x20
    const mask = new Uint8Array(w * h);
    for (let y = h - 22; y < h - 2; y++) {
      for (let x = w - 22; x < w - 2; x++) {
        mask[y * w + x] = 1;
        // Corrupt the watermark pixels
        const i = y * w + x;
        pixels[i * 4] = 255;
        pixels[i * 4 + 1] = 0;
        pixels[i * 4 + 2] = 255;
      }
    }

    const result = inpaintTelea(pixels, w, h, mask);

    // La zona reconstruida debe estar cerca del gris original
    for (let y = h - 22; y < h - 2; y++) {
      for (let x = w - 22; x < w - 2; x++) {
        const i = y * w + x;
        // Tolerancia amplia: Telea no sera perfecto pero debe estar en el rango correcto
        expect(result[i * 4]).toBeGreaterThan(100);
        expect(result[i * 4]).toBeLessThan(255);
        expect(result[i * 4 + 3]).toBe(255);
      }
    }

    // Pixeles fuera de la mascara no deben cambiar
    expect(result[0]).toBe(180); // Primer pixel (lejos del watermark)
  });

  it('devuelve una nueva copia (no muta el input)', () => {
    const w = 32,
      h = 32;
    const pixels = solidImage(w, h, 100, 100, 100);
    const originalCopy = new Uint8ClampedArray(pixels);
    const mask = new Uint8Array(w * h);
    mask[w * 16 + 16] = 1; // Un solo pixel

    const result = inpaintTelea(pixels, w, h, mask);

    // El input no debe haber sido modificado
    for (let i = 0; i < pixels.length; i++) {
      expect(pixels[i]).toBe(originalCopy[i]);
    }
    // El resultado debe ser un objeto diferente
    expect(result).not.toBe(pixels);
  });

  it('es rapido para mascaras de watermark tipicas', () => {
    const w = 512,
      h = 512;
    const pixels = gradientImage(w, h);

    // Mascara circular de radio ~30px en esquina (simula sparkle de Gemini)
    const mask = new Uint8Array(w * h);
    const cx = w - 60,
      cy = h - 60,
      r = 30;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          mask[y * w + x] = 1;
        }
      }
    }

    const start = performance.now();
    inpaintTelea(pixels, w, h, mask);
    const elapsed = performance.now() - start;

    // Debe completar en menos de 5 segundos (tipicamente <500ms)
    expect(elapsed).toBeLessThan(5000);
  });
});
