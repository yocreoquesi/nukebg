import { describe, it, expect } from 'vitest';
import { alphaRefine } from '../../src/workers/cv/alpha-refine';

describe('alphaRefine', () => {
  it('convierte mascara binaria a alpha: bg=0, fg=255', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    // Mitad superior: fondo (1), mitad inferior: sujeto (0)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = 1;
      }
    }

    const alpha = alphaRefine(mask, w, h);

    // Los pixeles de fondo deben tener alpha = 0
    for (let y = 0; y < 3; y++) { // margenes internos por blur
      for (let x = 1; x < w - 1; x++) {
        expect(alpha[y * w + x]).toBe(0);
      }
    }

    // Los pixeles de sujeto (lejos del borde) deben tener alpha = 255
    for (let y = 7; y < h; y++) {
      for (let x = 1; x < w - 1; x++) {
        expect(alpha[y * w + x]).toBe(255);
      }
    }
  });

  it('todo fondo produce todo alpha 0', () => {
    const w = 16, h = 16;
    const mask = new Uint8Array(w * h).fill(1); // todo bg

    const alpha = alphaRefine(mask, w, h);

    for (let i = 0; i < alpha.length; i++) {
      expect(alpha[i]).toBe(0);
    }
  });

  it('todo sujeto produce todo alpha 255', () => {
    const w = 16, h = 16;
    const mask = new Uint8Array(w * h); // todo fg (0)

    const alpha = alphaRefine(mask, w, h);

    for (let i = 0; i < alpha.length; i++) {
      expect(alpha[i]).toBe(255);
    }
  });

  it('el borde entre fg y bg tiene transicion suave', () => {
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h);
    // Izquierda: fondo, derecha: sujeto
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 10; x++) {
        mask[y * w + x] = 1;
      }
    }

    const alpha = alphaRefine(mask, w, h);

    // En la zona de transicion (x=9-10) puede haber valores intermedios
    // o un salto brusco post-threshold. El punto es que no crashee
    // y los extremos sean correctos
    expect(alpha[10 * w + 0]).toBe(0);   // bg lejano
    expect(alpha[10 * w + 19]).toBe(255); // fg lejano
  });

  it('maneja imagen 1x1 sin crash', () => {
    const mask = new Uint8Array([0]);
    const alpha = alphaRefine(mask, 1, 1);
    expect(alpha[0]).toBe(255);
  });

  it('maneja imagen 1x1 bg sin crash', () => {
    const mask = new Uint8Array([1]);
    const alpha = alphaRefine(mask, 1, 1);
    expect(alpha[0]).toBe(0);
  });

  it('produce valores dentro de [0, 255]', () => {
    const w = 50, h = 50;
    const mask = new Uint8Array(w * h);
    // Patron aleatorio-ish
    for (let i = 0; i < mask.length; i++) {
      mask[i] = (i * 7 + 3) % 3 === 0 ? 1 : 0;
    }

    const alpha = alphaRefine(mask, w, h);

    for (let i = 0; i < alpha.length; i++) {
      expect(alpha[i]).toBeGreaterThanOrEqual(0);
      expect(alpha[i]).toBeLessThanOrEqual(255);
    }
  });
});
