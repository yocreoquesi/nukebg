import { describe, it, expect } from 'vitest';

/**
 * Tests para extractTransferables y que originalPixels no se corrompe
 * al transferir buffers a los workers.
 *
 * El PipelineOrchestrator.extractTransferables es un metodo estatico privado,
 * pero podemos replicar su logica aqui y verificar que las copias usadas
 * para transfer no afectan el buffer original.
 */

/** Replica de PipelineOrchestrator.extractTransferables */
function extractTransferables(payload: Record<string, any> | undefined): Transferable[] {
  if (!payload) return [];
  const transferables: Transferable[] = [];
  for (const val of Object.values(payload)) {
    if (val instanceof ArrayBuffer) {
      transferables.push(val);
    } else if (ArrayBuffer.isView(val) && val.buffer instanceof ArrayBuffer) {
      transferables.push(val.buffer);
    }
  }
  return transferables;
}

describe('extractTransferables', () => {
  it('devuelve array vacio para payload undefined', () => {
    expect(extractTransferables(undefined)).toEqual([]);
  });

  it('devuelve array vacio para payload sin typed arrays', () => {
    expect(extractTransferables({ width: 10, height: 10 })).toEqual([]);
  });

  it('extrae ArrayBuffer directo', () => {
    const buf = new ArrayBuffer(16);
    const result = extractTransferables({ data: buf });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(buf);
  });

  it('extrae buffer de un TypedArray (Uint8ClampedArray)', () => {
    const arr = new Uint8ClampedArray(100);
    const result = extractTransferables({ pixels: arr });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(arr.buffer);
  });

  it('extrae buffer de un Uint8Array', () => {
    const arr = new Uint8Array(50);
    const result = extractTransferables({ mask: arr });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(arr.buffer);
  });

  it('extrae multiples transferables del mismo payload', () => {
    const pixels = new Uint8ClampedArray(100);
    const mask = new Uint8Array(25);
    const result = extractTransferables({ pixels, mask, width: 10 });
    expect(result).toHaveLength(2);
  });

  it('ignora valores no-buffer (numeros, strings, null)', () => {
    const result = extractTransferables({
      width: 100,
      height: 200,
      name: 'test',
      empty: null,
    });
    expect(result).toEqual([]);
  });
});

describe('originalPixels no se corrompe al usar extractTransferables', () => {
  it('copiar pixels y transferir la copia no afecta el original', () => {
    // Simula lo que hace PipelineOrchestrator.process():
    // const originalPixels = new Uint8ClampedArray(imageData.data);
    // luego cada cvCall usa: new Uint8ClampedArray(imageData.data) como copia
    const width = 16, height = 16;
    const originalData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < originalData.length; i++) {
      originalData[i] = i % 256;
    }

    // originalPixels es la copia pristina
    const originalPixels = new Uint8ClampedArray(originalData);

    // Cada worker call crea su propia copia
    const workerCopy = new Uint8ClampedArray(originalData);
    const transferables = extractTransferables({ pixels: workerCopy });

    // extractTransferables solo identifica los buffers, no los transfiere.
    // Pero incluso tras "transferir" (aqui simulado), originalPixels queda intacto.
    expect(transferables).toHaveLength(1);

    // originalPixels sigue intacto
    expect(originalPixels.length).toBe(width * height * 4);
    expect(originalPixels.buffer.byteLength).toBe(width * height * 4);

    // Verificar pixel por pixel
    for (let i = 0; i < originalPixels.length; i++) {
      expect(originalPixels[i]).toBe(i % 256);
    }
  });

  it('multiples copias son independientes del original', () => {
    const width = 8, height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i++) {
      source[i] = 200;
    }

    const originalPixels = new Uint8ClampedArray(source);

    // Crear 3 copias como haria el orchestrator (detect-bg, ml-segment, watermark)
    const copy1 = new Uint8ClampedArray(source);
    const copy2 = new Uint8ClampedArray(source);
    const copy3 = new Uint8ClampedArray(source);

    // Modify the copies (as a worker would)
    copy1.fill(0);
    copy2.fill(128);
    copy3.fill(255);

    // Original intacto
    for (let i = 0; i < originalPixels.length; i++) {
      expect(originalPixels[i]).toBe(200);
    }
  });

  it('la composicion final usa originalPixels sin corrupcion', () => {
    const width = 4, height = 4;
    const imagePixels = new Uint8ClampedArray(width * height * 4);
    // Fill with known colors
    for (let i = 0; i < width * height; i++) {
      imagePixels[i * 4] = 100;     // R
      imagePixels[i * 4 + 1] = 150; // G
      imagePixels[i * 4 + 2] = 200; // B
      imagePixels[i * 4 + 3] = 255; // A
    }

    // Copia pristina (como en orchestrator)
    const originalPixels = new Uint8ClampedArray(imagePixels);

    // Simular transferencia de copias a workers
    const workerPayload = { pixels: new Uint8ClampedArray(imagePixels), width, height };
    extractTransferables(workerPayload);

    // Simular ML alpha
    const alpha = new Uint8Array(width * height);
    alpha.fill(200);
    alpha[0] = 0; // primer pixel = fondo

    // Composicion final (replica del orchestrator)
    const resultPixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      resultPixels[i * 4] = originalPixels[i * 4];
      resultPixels[i * 4 + 1] = originalPixels[i * 4 + 1];
      resultPixels[i * 4 + 2] = originalPixels[i * 4 + 2];
      resultPixels[i * 4 + 3] = alpha[i];
    }

    // Primer pixel: RGB del original, alpha=0
    expect(resultPixels[0]).toBe(100);
    expect(resultPixels[1]).toBe(150);
    expect(resultPixels[2]).toBe(200);
    expect(resultPixels[3]).toBe(0);

    // Segundo pixel: RGB del original, alpha=200
    expect(resultPixels[4]).toBe(100);
    expect(resultPixels[5]).toBe(150);
    expect(resultPixels[6]).toBe(200);
    expect(resultPixels[7]).toBe(200);
  });
});
