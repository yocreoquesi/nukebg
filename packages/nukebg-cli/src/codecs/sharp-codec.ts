import sharp from 'sharp';
import type { ImageCodec, EncodeFormat } from 'nukebg-core';
import type { ImageDataLike } from 'nukebg-core';
import { DecodeError, createImageDataLike } from 'nukebg-core';

// ---------------------------------------------------------------------------
// Magic-byte detection — identifies image format from the first bytes of the
// buffer before handing off to sharp. This allows early rejection of clearly
// non-image data with a clear DecodeError rather than a cryptic sharp error.
// ---------------------------------------------------------------------------

function detectFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | 'unknown' {
  if (bytes.length < 4) return 'unknown';

  // PNG: 89 50 4E 47 (the classic PNG magic)
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: RIFF????WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'webp';
  }

  // GIF: 47 49 46 38
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// SharpImageCodec
// ---------------------------------------------------------------------------

/**
 * Node-only implementation of the `ImageCodec` interface backed by `sharp`.
 *
 * decode: accepts PNG, JPEG, WebP (and other formats sharp supports).
 *         Always returns 4-channel RGBA via `.ensureAlpha()`.
 *         Rejects with `DecodeError` ("DECODE_FAILED") for unrecognised bytes.
 *
 * encode: converts an `ImageDataLike` (RGBA flat array) back to PNG or WebP.
 */
export class SharpImageCodec implements ImageCodec {
  async decode(
    bytes: Uint8Array | ArrayBufferView,
    opts?: { maxDimension?: number },
  ): Promise<{
    image: ImageDataLike;
    originalWidth: number;
    originalHeight: number;
    wasDownsampled: boolean;
  }> {
    const buf = bytes instanceof Uint8Array
      ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Buffer.from((bytes as ArrayBufferView).buffer);

    // Quick magic-byte check — reject obviously non-image data early
    const asUint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const fmt = detectFormat(asUint8);
    if (fmt === 'unknown') {
      throw new DecodeError(
        `Cannot decode bytes: unrecognised image format (first bytes: ${Array.from(asUint8.slice(0, 4))
          .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
          .join(' ')})`,
      );
    }

    let img = sharp(buf).ensureAlpha();

    // Retrieve metadata to know original dimensions before any resize
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buf).metadata();
    } catch (cause) {
      throw new DecodeError(`Failed to read image metadata`, { cause });
    }

    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;

    let wasDownsampled = false;

    if (opts?.maxDimension !== undefined) {
      const maxDim = opts.maxDimension;
      if (originalWidth > maxDim || originalHeight > maxDim) {
        wasDownsampled = true;
        img = img.resize({
          width: maxDim,
          height: maxDim,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
    }

    let rawBuf: Buffer;
    let info: sharp.OutputInfo;
    try {
      ({ data: rawBuf, info } = await img.raw().toBuffer({ resolveWithObject: true }));
    } catch (cause) {
      throw new DecodeError(`sharp failed to decode image`, { cause });
    }

    const data = new Uint8ClampedArray(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
    const image = createImageDataLike(data, info.width, info.height);

    return { image, originalWidth, originalHeight, wasDownsampled };
  }

  async encode(
    image: ImageDataLike,
    format: EncodeFormat,
    opts?: { quality?: number },
  ): Promise<Uint8Array> {
    const { data, width, height } = image;

    // sharp expects a plain Buffer; Uint8ClampedArray is compatible in layout
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    const pipeline = sharp(buf, {
      raw: { width, height, channels: 4 },
    });

    let outBuf: Buffer;
    switch (format) {
      case 'png':
        outBuf = await pipeline.png().toBuffer();
        break;
      case 'webp':
        outBuf = await pipeline
          .webp({ quality: opts?.quality ?? 80, lossless: false })
          .toBuffer();
        break;
      default: {
        const _exhaustive: never = format;
        throw new Error(`Unsupported format: ${_exhaustive as string}`);
      }
    }

    return new Uint8Array(outBuf.buffer, outBuf.byteOffset, outBuf.byteLength);
  }
}
