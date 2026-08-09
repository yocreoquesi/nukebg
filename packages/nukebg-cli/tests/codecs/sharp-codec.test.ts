import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { SharpImageCodec } from '../../src/codecs/sharp-codec.js';
import { DecodeError } from 'nukebg-core';

// ---------------------------------------------------------------------------
// Test fixture generators — produce image bytes programmatically via sharp
// so no binary fixtures need to be committed.
// ---------------------------------------------------------------------------

let pngBytes: Uint8Array;
let jpegBytes: Uint8Array;
let rgbaPngBytes: Uint8Array; // RGBA with a transparent region

const WIDTH = 8;
const HEIGHT = 8;

beforeAll(async () => {
  // Solid red 8x8 PNG (opaque)
  pngBytes = new Uint8Array(
    await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer(),
  );

  // Solid blue 8x8 JPEG
  jpegBytes = new Uint8Array(
    await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer(),
  );

  // RGBA 8x8 PNG: top half fully opaque (alpha=255), bottom half fully transparent (alpha=0)
  const rgbaPixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      rgbaPixels[i] = 0; // R
      rgbaPixels[i + 1] = 200; // G
      rgbaPixels[i + 2] = 100; // B
      rgbaPixels[i + 3] = y < HEIGHT / 2 ? 255 : 0; // A
    }
  }
  rgbaPngBytes = new Uint8Array(
    await sharp(Buffer.from(rgbaPixels), {
      raw: { width: WIDTH, height: HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer(),
  );
});

// ---------------------------------------------------------------------------
// decode — Task 11.1 tests (RED phase → will fail until 11.2 is implemented)
// ---------------------------------------------------------------------------

describe('SharpImageCodec.decode', () => {
  it('decodes a valid PNG into ImageDataLike with correct dimensions', async () => {
    const codec = new SharpImageCodec();
    const result = await codec.decode(pngBytes);

    expect(result.image.width).toBe(WIDTH);
    expect(result.image.height).toBe(HEIGHT);
    expect(result.image.data.length).toBe(WIDTH * HEIGHT * 4);
    expect(result.originalWidth).toBe(WIDTH);
    expect(result.originalHeight).toBe(HEIGHT);
    expect(result.wasDownsampled).toBe(false);
  });

  it('decodes a valid JPEG into ImageDataLike with correct dimensions', async () => {
    const codec = new SharpImageCodec();
    const result = await codec.decode(jpegBytes);

    expect(result.image.width).toBe(WIDTH);
    expect(result.image.height).toBe(HEIGHT);
    expect(result.image.data.length).toBe(WIDTH * HEIGHT * 4);
    expect(result.wasDownsampled).toBe(false);
  });

  it('rejects with DecodeError (code "DECODE_FAILED") for invalid/non-image bytes', async () => {
    const codec = new SharpImageCodec();
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

    await expect(codec.decode(garbage)).rejects.toSatisfy(
      (e: unknown) => e instanceof DecodeError && (e as DecodeError).code === 'DECODE_FAILED',
    );
  });

  it('preserves alpha channel: transparent pixels stay alpha=0 after decode', async () => {
    const codec = new SharpImageCodec();
    const result = await codec.decode(rgbaPngBytes);

    const { data, width, height } = result.image;
    expect(data.length).toBe(width * height * 4);

    // Bottom half should be fully transparent (alpha = 0)
    for (let y = Math.floor(height / 2); y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        expect(alpha).toBe(0);
      }
    }

    // Top half should be fully opaque (alpha = 255)
    for (let y = 0; y < Math.floor(height / 2); y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        expect(alpha).toBe(255);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// encode — Task 11.3 tests (RED phase → will fail until 11.4 is implemented)
// ---------------------------------------------------------------------------

describe('SharpImageCodec.encode', () => {
  it('encodes ImageDataLike to PNG with valid PNG magic bytes', async () => {
    const codec = new SharpImageCodec();

    // Build a simple 4x4 RGBA image
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const image = { data: pixels, width: 4, height: 4 };

    const encoded = await codec.encode(image, 'png');

    // PNG magic: 0x89 0x50 0x4E 0x47
    expect(encoded[0]).toBe(0x89);
    expect(encoded[1]).toBe(0x50); // P
    expect(encoded[2]).toBe(0x4e); // N
    expect(encoded[3]).toBe(0x47); // G
  });

  it('encodes ImageDataLike to WebP with valid RIFF/WEBP header', async () => {
    const codec = new SharpImageCodec();

    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const image = { data: pixels, width: 4, height: 4 };

    const encoded = await codec.encode(image, 'webp');

    // RIFF header: 0x52 0x49 0x46 0x46 (RIFF)
    expect(encoded[0]).toBe(0x52); // R
    expect(encoded[1]).toBe(0x49); // I
    expect(encoded[2]).toBe(0x46); // F
    expect(encoded[3]).toBe(0x46); // F

    // Bytes 8–11 should be WEBP: 0x57 0x45 0x42 0x50
    expect(encoded[8]).toBe(0x57); // W
    expect(encoded[9]).toBe(0x45); // E
    expect(encoded[10]).toBe(0x42); // B
    expect(encoded[11]).toBe(0x50); // P
  });

  it('round-trip: encode PNG then decode → pixel data is identical', async () => {
    const codec = new SharpImageCodec();

    // Build a known RGBA image
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 100; // R
      pixels[i + 1] = 150; // G
      pixels[i + 2] = 200; // B
      pixels[i + 3] = 128; // A (semi-transparent)
    }
    const image = { data: pixels, width, height };

    const encoded = await codec.encode(image, 'png');
    const decoded = await codec.decode(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));

    expect(decoded.image.width).toBe(width);
    expect(decoded.image.height).toBe(height);
    expect(decoded.image.data.length).toBe(pixels.length);

    // PNG is lossless — pixels must be identical
    for (let i = 0; i < pixels.length; i++) {
      expect(decoded.image.data[i]).toBe(pixels[i]);
    }
  });
});
