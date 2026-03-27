import type { SupportedFormat, ImageLoadResult } from '../types/image';
import { MAX_DIMENSION } from '../types/image';

const SUPPORTED_FORMATS: SupportedFormat[] = ['image/png', 'image/jpeg', 'image/webp'];

/** Max file size in bytes (50 MB, per security policy) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export function isSupportedFormat(type: string): type is SupportedFormat {
  return SUPPORTED_FORMATS.includes(type as SupportedFormat);
}

/**
 * Load an image file to ImageData, downsampling if needed.
 */
export async function loadImage(file: File): Promise<ImageLoadResult> {
  if (!isSupportedFormat(file.type)) {
    throw new Error(`Unsupported format: ${file.type}. Use PNG, JPG, or WebP.`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${Math.round(file.size / 1024 / 1024)} MB. Maximum is 50 MB.`);
  }

  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;

  let targetWidth = originalWidth;
  let targetHeight = originalHeight;
  let wasDownsampled = false;

  if (originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(originalWidth, originalHeight);
    targetWidth = Math.round(originalWidth * scale);
    targetHeight = Math.round(originalHeight * scale);
    wasDownsampled = true;
  }

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

  return {
    imageData,
    originalWidth,
    originalHeight,
    wasDownsampled,
    format: file.type as SupportedFormat,
  };
}

/**
 * Export ImageData as a PNG Blob with NukeBG metadata embedded.
 * Injects tEXt chunks (Software, URL) into the PNG before IEND.
 */
export async function exportPng(imageData: ImageData): Promise<Blob> {
  let rawBlob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    rawBlob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    // Safari iOS fallback using HTMLCanvasElement
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    rawBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    });
  }
  return injectPngMetadata(rawBlob, {
    'Software': 'NukeBG v1.1.0',
    'Source': 'https://nukebg.app',
  });
}

/**
 * Inject tEXt chunks into an existing PNG blob.
 * PNG format: signature + chunks. Each chunk = length(4) + type(4) + data + crc(4).
 * We insert tEXt chunks right before the IEND chunk.
 */
async function injectPngMetadata(
  blob: Blob,
  metadata: Record<string, string>,
): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const data = new Uint8Array(buffer);

  // Find IEND chunk (last 12 bytes: length=0 + "IEND" + CRC)
  const iendOffset = findIEND(data);
  if (iendOffset < 0) return blob; // Can't find IEND, return as-is

  // Build tEXt chunks
  const textChunks: Uint8Array[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    textChunks.push(createTextChunk(key, value));
  }

  // Combine: everything before IEND + text chunks + IEND
  const beforeIEND = data.slice(0, iendOffset);
  const iendChunk = data.slice(iendOffset);
  const totalSize = beforeIEND.length + textChunks.reduce((s, c) => s + c.length, 0) + iendChunk.length;

  const result = new Uint8Array(totalSize);
  let offset = 0;
  result.set(beforeIEND, offset); offset += beforeIEND.length;
  for (const chunk of textChunks) {
    result.set(chunk, offset); offset += chunk.length;
  }
  result.set(iendChunk, offset);

  return new Blob([result], { type: 'image/png' });
}

/** Find the byte offset of the IEND chunk in a PNG */
function findIEND(data: Uint8Array): number {
  // Search backwards for "IEND" (0x49 0x45 0x4E 0x44)
  for (let i = data.length - 8; i >= 8; i--) {
    if (data[i] === 0x49 && data[i + 1] === 0x45 &&
        data[i + 2] === 0x4E && data[i + 3] === 0x44) {
      return i - 4; // -4 for the length field before the type
    }
  }
  return -1;
}

/** Create a PNG tEXt chunk: keyword + null separator + text */
function createTextChunk(keyword: string, text: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(text);
  const dataLen = keyBytes.length + 1 + textBytes.length; // +1 for null separator
  const chunkType = new TextEncoder().encode('tEXt');

  // Chunk: length(4) + type(4) + data + crc(4)
  const chunk = new Uint8Array(4 + 4 + dataLen + 4);
  const view = new DataView(chunk.buffer);

  // Length (big-endian)
  view.setUint32(0, dataLen);

  // Type
  chunk.set(chunkType, 4);

  // Data: keyword + \0 + text
  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0; // null separator
  chunk.set(textBytes, 8 + keyBytes.length + 1);

  // CRC32 over type + data
  const crc = crc32(chunk.slice(4, 4 + 4 + dataLen));
  view.setUint32(4 + 4 + dataLen, crc);

  return chunk;
}

/** CRC32 for PNG chunks */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Nuclear-themed prefixes that rotate randomly */
const NUKE_PREFIXES = [
  'nuked', 'decontaminated', 'defused', 'irradiated', 'fallout-free',
  'meltdown', 'reactor-clean', 'half-life', 'chain-reaction',
  'ground-zero', 'critical-mass', 'blast-zone', 'warhead', 'enriched',
  'fission', 'fusion', 'plutonium', 'uranium', 'chernobyl', 'geiger',
  'containment', 'bunker', 'hazmat', 'atomic', 'thermonuclear',
  'payload', 'detonated', 'vaporized', 'obliterated',
];

/** Holiday-specific prefixes by month-day */
const HOLIDAY_PREFIXES: Record<string, string> = {
  '01-01': 'new-year-nuke',
  '02-14': 'love-nuked',
  '04-01': 'rickrolled',
  '07-04': 'freedom-nuked',
  '10-31': 'spooky-nuke',
  '12-25': 'nukemas',
};

/**
 * Generate output filename with nuclear-themed prefix.
 * On holidays: first download gets the special name, rest are random.
 * Normal days: always random from pool.
 */
let holidayUsed = false;

export function generateOutputFilename(inputName: string): string {
  const base = inputName.replace(/\.[^.]+$/, '');
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let prefix: string;
  const holidayPrefix = HOLIDAY_PREFIXES[monthDay];

  if (holidayPrefix && !holidayUsed) {
    prefix = holidayPrefix;
    holidayUsed = true;
  } else {
    prefix = NUKE_PREFIXES[Math.floor(Math.random() * NUKE_PREFIXES.length)];
  }

  return `${prefix}-${base}.png`;
}
