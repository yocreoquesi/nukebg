import { describe, it, expect } from 'vitest';
import { detectCheckerGrid } from '../../src/workers/cv/detect-checker-grid';
import { checkerboardImage, solidImage } from '../helpers';

describe('detectCheckerGrid', () => {
  it('detecta grid de 16px en checkerboard clasico', () => {
    const gridSize = 16;
    const dark: [number, number, number] = [191, 191, 191];
    const light: [number, number, number] = [255, 255, 255];
    const pixels = checkerboardImage(256, 256, gridSize, dark, light);

    const result = detectCheckerGrid(pixels, 256, 256, dark, light);

    expect(result.gridSize).toBeGreaterThan(0);
    // La deteccion puede tener +/-1 de error
    expect(Math.abs(result.gridSize - gridSize)).toBeLessThanOrEqual(2);
  });

  it('detecta grid de 32px', () => {
    const gridSize = 32;
    const dark: [number, number, number] = [180, 180, 180];
    const light: [number, number, number] = [240, 240, 240];
    const pixels = checkerboardImage(256, 256, gridSize, dark, light);

    const result = detectCheckerGrid(pixels, 256, 256, dark, light);

    expect(result.gridSize).toBeGreaterThan(0);
    expect(Math.abs(result.gridSize - gridSize)).toBeLessThanOrEqual(2);
  });

  it('detecta grid de 8px (minimo)', () => {
    const gridSize = 8;
    const dark: [number, number, number] = [150, 150, 150];
    const light: [number, number, number] = [250, 250, 250];
    const pixels = checkerboardImage(256, 256, gridSize, dark, light);

    const result = detectCheckerGrid(pixels, 256, 256, dark, light);

    expect(result.gridSize).toBeGreaterThanOrEqual(8);
  });

  it('devuelve gridSize 0 para imagen solida (sin grid)', () => {
    const dark: [number, number, number] = [200, 200, 200];
    const light: [number, number, number] = [200, 200, 200];
    const pixels = solidImage(256, 256, 200, 200, 200);

    const result = detectCheckerGrid(pixels, 256, 256, dark, light);

    expect(result.gridSize).toBe(0);
  });

  it('devuelve phase 0 o 1', () => {
    const dark: [number, number, number] = [180, 180, 180];
    const light: [number, number, number] = [240, 240, 240];
    const pixels = checkerboardImage(256, 256, 16, dark, light);

    const result = detectCheckerGrid(pixels, 256, 256, dark, light);

    expect([0, 1]).toContain(result.phase);
  });

  it('maneja imagen pequena sin crash', () => {
    const dark: [number, number, number] = [100, 100, 100];
    const light: [number, number, number] = [200, 200, 200];
    const pixels = checkerboardImage(16, 16, 4, dark, light);

    // No debe lanzar excepcion
    const result = detectCheckerGrid(pixels, 16, 16, dark, light);
    expect(result).toBeDefined();
  });
});
