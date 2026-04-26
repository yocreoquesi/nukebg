import { describe, it, expect } from 'vitest';
import {
  RingBuffer,
  pixelIndex,
  maxChannelDiff,
  mean,
  std,
  median,
} from '../../src/workers/cv/utils';

describe('pixelIndex', () => {
  it('calcula el indice RGBA correcto', () => {
    expect(pixelIndex(0, 0, 100)).toBe(0);
    expect(pixelIndex(1, 0, 100)).toBe(4);
    expect(pixelIndex(0, 1, 100)).toBe(400);
    expect(pixelIndex(5, 3, 10)).toBe((3 * 10 + 5) * 4);
  });
});

describe('maxChannelDiff', () => {
  it('devuelve la maxima diferencia absoluta por canal', () => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 255]);
    expect(maxChannelDiff(pixels, 0, [100, 150, 200])).toBe(0);
    expect(maxChannelDiff(pixels, 0, [90, 150, 200])).toBe(10);
    expect(maxChannelDiff(pixels, 0, [100, 100, 100])).toBe(100);
  });
});

describe('mean', () => {
  it('calcula la media de un array', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(mean([10])).toBe(10);
    expect(mean([])).toBe(0);
  });
});

describe('std', () => {
  it('devuelve 0 para array vacio', () => {
    expect(std([])).toBe(0);
  });

  it('devuelve 0 para todos iguales', () => {
    expect(std([5, 5, 5, 5])).toBe(0);
  });

  it('calcula desviacion estandar poblacional', () => {
    // std([0, 10]) = sqrt(25) = 5
    expect(std([0, 10])).toBe(5);
  });
});

describe('median', () => {
  it('devuelve 0 para array vacio', () => {
    expect(median([])).toBe(0);
  });

  it('calcula mediana de longitud impar', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('calcula mediana de longitud par', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('RingBuffer', () => {
  it('push y pop en orden FIFO', () => {
    const buf = new RingBuffer(4);
    buf.push(10, 20);
    buf.push(30, 40);
    expect(buf.size).toBe(2);
    expect(buf.empty).toBe(false);

    const [y1, x1] = buf.pop();
    expect(y1).toBe(10);
    expect(x1).toBe(20);

    const [y2, x2] = buf.pop();
    expect(y2).toBe(30);
    expect(x2).toBe(40);
    expect(buf.empty).toBe(true);
  });

  it('crece automaticamente al exceder capacidad', () => {
    const buf = new RingBuffer(2);
    buf.push(1, 1);
    buf.push(2, 2);
    buf.push(3, 3); // deberia trigger grow
    expect(buf.size).toBe(3);

    expect(buf.pop()).toEqual([1, 1]);
    expect(buf.pop()).toEqual([2, 2]);
    expect(buf.pop()).toEqual([3, 3]);
    expect(buf.empty).toBe(true);
  });

  it('maneja wrap-around correctamente', () => {
    const buf = new RingBuffer(3);
    buf.push(1, 1);
    buf.push(2, 2);
    buf.pop(); // head avanza
    buf.push(3, 3);
    buf.push(4, 4); // wrap around

    expect(buf.pop()).toEqual([2, 2]);
    expect(buf.pop()).toEqual([3, 3]);
    expect(buf.pop()).toEqual([4, 4]);
  });
});
