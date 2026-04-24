import { describe, it, expect } from 'vitest';
import { loadImage } from '../../src/utils/image-io';

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPEG_MAGIC = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
const WEBP_MAGIC = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function fileFrom(bytes: Uint8Array, name: string, type: string): File {
  // Cast to BlobPart explicitly — TS 6 narrows Uint8Array's underlying
  // buffer to `ArrayBufferLike` (which includes SharedArrayBuffer) and
  // refuses the literal `BlobPart` constructor union. The Blob spec
  // accepts any TypedArray, so this cast is sound at runtime.
  return new File([bytes as BlobPart], name, { type });
}

describe('loadImage magic-byte sniffing', () => {
  it('rejects a file whose MIME says PNG but whose bytes do not match', async () => {
    const fake = fileFrom(new Uint8Array([0x4D, 0x5A, 0x90, 0x00]), 'fake.png', 'image/png');
    await expect(loadImage(fake)).rejects.toThrow(/not a valid PNG, JPG, or WebP|does not match/i);
  });

  it('rejects a renamed JPEG masquerading as PNG', async () => {
    const renamed = fileFrom(JPEG_MAGIC, 'photo.png', 'image/png');
    await expect(loadImage(renamed)).rejects.toThrow(/does not match/i);
  });

  it('rejects unsupported MIME types before sniffing', async () => {
    const gif = fileFrom(PNG_MAGIC, 'img.gif', 'image/gif');
    await expect(loadImage(gif)).rejects.toThrow(/Unsupported format/i);
  });

  it('rejects files below the 12-byte sniff window', async () => {
    const tiny = fileFrom(new Uint8Array([0x89, 0x50, 0x4E]), 'tiny.png', 'image/png');
    await expect(loadImage(tiny)).rejects.toThrow(/not a valid PNG, JPG, or WebP/i);
  });

  it('passes the magic-byte gate for a valid PNG header (decode fails downstream)', async () => {
    // A real decode is out of scope (happy-dom has no canvas). Here we just
    // confirm the error surface is not the sniff error.
    const pngStub = fileFrom(PNG_MAGIC, 'img.png', 'image/png');
    await expect(loadImage(pngStub)).rejects.not.toThrow(/does not match|not a valid/i);
  });

  it('passes the magic-byte gate for a valid WebP header', async () => {
    const webpStub = fileFrom(WEBP_MAGIC, 'img.webp', 'image/webp');
    await expect(loadImage(webpStub)).rejects.not.toThrow(/does not match|not a valid/i);
  });
});
