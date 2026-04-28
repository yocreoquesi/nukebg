import type { SupportedFormat, ImageLoadResult, ExportFormat } from '../types/image';
import { getCapability, computeTargetSize, ABSOLUTE_MAX_PIXELS } from './capability-detector';

const SUPPORTED_FORMATS: SupportedFormat[] = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Max file size in bytes (80 MB). A 32 MP JPEG at high quality lands
 * around 20-40 MB; this gives headroom for PNG and very-high-res inputs.
 */
const MAX_FILE_SIZE = 80 * 1024 * 1024;

export function isSupportedFormat(type: string): type is SupportedFormat {
  return SUPPORTED_FORMATS.includes(type as SupportedFormat);
}

/**
 * Inspect the first bytes of a file and return the image format identified
 * by its magic bytes. Returns null if none of the supported formats match.
 * Defense-in-depth against rename attacks (e.g. `.exe` → `.png`).
 */
async function sniffImageFormat(file: File): Promise<SupportedFormat | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return null;

  // PNG:  89 50 4E 47 0D 0A 1A 0A
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: "RIFF" <size: LE uint32> "WEBP"
  // The size field at bytes 4-7 (little-endian uint32) declares the byte
  // count of everything after the size itself, so it must equal
  // file.size - 8. Validating this guards against polyglot files that
  // pass the magic-byte check but carry trailing/truncated content
  // (#189).
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    const declaredSize = (head[4] | (head[5] << 8) | (head[6] << 16) | (head[7] << 24)) >>> 0;
    if (declaredSize + 8 !== file.size) return null;
    return 'image/webp';
  }
  return null;
}

/**
 * Load an image file to ImageData, downsampling if needed.
 */
export async function loadImage(file: File): Promise<ImageLoadResult> {
  if (!isSupportedFormat(file.type)) {
    throw new Error(`Unsupported format: ${file.type}. Use PNG, JPG, or WebP.`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${Math.round(file.size / 1024 / 1024)} MB. Maximum is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
    );
  }

  // Magic-byte sniff: refuses renamed non-image files before the decoder
  // gets a chance to crash cryptically on them.
  const sniffed = await sniffImageFormat(file);
  if (!sniffed) {
    throw new Error('File is not a valid PNG, JPG, or WebP. It may be corrupted or renamed.');
  }
  if (sniffed !== file.type) {
    throw new Error(`File content (${sniffed}) does not match its extension (${file.type}).`);
  }

  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const origPixels = originalWidth * originalHeight;

  // Hard ceiling: reject images above the absolute max, regardless of device.
  // Chromium canvases top out around 16384 per side and ~268 MP area.
  if (origPixels > ABSOLUTE_MAX_PIXELS) {
    bitmap.close();
    const mp = (origPixels / 1_000_000).toFixed(1);
    const maxMp = Math.round(ABSOLUTE_MAX_PIXELS / 1_000_000);
    throw new Error(`Image too large: ${mp} MP. Maximum supported is ${maxMp} MP.`);
  }

  const capability = getCapability();
  const target = computeTargetSize(originalWidth, originalHeight, capability);

  // Read original at full resolution first (used for final composite)
  const originalImageData = await rasterizeBitmap(bitmap, originalWidth, originalHeight);

  let imageData: ImageData;
  if (target.needsDownscale) {
    imageData = await rasterizeBitmap(bitmap, target.width, target.height);
  } else {
    // Share the same buffer — no extra memory cost.
    imageData = originalImageData;
  }
  bitmap.close();

  return {
    imageData,
    originalImageData,
    originalWidth,
    originalHeight,
    wasDownsampled: target.needsDownscale,
    format: file.type as SupportedFormat,
  };
}

/** Draw a bitmap into an ImageData at the given target size. */
async function rasterizeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<ImageData> {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d')! as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  // High-quality downscale for better alpha-edge results after upscale.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
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
    Software: 'NukeBG v2.9.5',
    Source: 'https://nukebg.app',
  });
}

/**
 * Export ImageData as a WebP Blob.
 * No metadata injection for WebP (XMP/EXIF too complex, skip for now).
 */
export async function exportWebp(imageData: ImageData, quality = 0.95): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }
  // Safari fallback using HTMLCanvasElement
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed for WebP'));
      },
      'image/webp',
      quality,
    );
  });
}

/**
 * Inject tEXt chunks into an existing PNG blob.
 * PNG format: signature + chunks. Each chunk = length(4) + type(4) + data + crc(4).
 * We insert tEXt chunks right before the IEND chunk.
 */
async function injectPngMetadata(blob: Blob, metadata: Record<string, string>): Promise<Blob> {
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
  const totalSize =
    beforeIEND.length + textChunks.reduce((s, c) => s + c.length, 0) + iendChunk.length;

  const result = new Uint8Array(totalSize);
  let offset = 0;
  result.set(beforeIEND, offset);
  offset += beforeIEND.length;
  for (const chunk of textChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  result.set(iendChunk, offset);

  return new Blob([result], { type: 'image/png' });
}

/** Find the byte offset of the IEND chunk in a PNG */
function findIEND(data: Uint8Array): number {
  // Search backwards for "IEND" (0x49 0x45 0x4E 0x44)
  for (let i = data.length - 8; i >= 8; i--) {
    if (data[i] === 0x49 && data[i + 1] === 0x45 && data[i + 2] === 0x4e && data[i + 3] === 0x44) {
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
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Nuclear-themed prefixes that rotate randomly, keyed by locale */
const NUKE_PREFIXES: Record<string, string[]> = {
  en: [
    'nuked',
    'decontaminated',
    'defused',
    'irradiated',
    'fallout-free',
    'meltdown',
    'reactor-clean',
    'half-life',
    'chain-reaction',
    'ground-zero',
    'critical-mass',
    'blast-zone',
    'warhead',
    'enriched',
    'fission',
    'fusion',
    'plutonium',
    'uranium',
    'chernobyl',
    'geiger',
    'containment',
    'bunker',
    'hazmat',
    'atomic',
    'thermonuclear',
    'payload',
    'detonated',
    'vaporized',
    'obliterated',
  ],
  es: [
    'nukeado',
    'descontaminado',
    'desactivado',
    'irradiado',
    'sin-radiacion',
    'fusion-nuclear',
    'reactor-limpio',
    'vida-media',
    'reaccion-en-cadena',
    'zona-cero',
    'masa-critica',
    'zona-de-impacto',
    'ojiva',
    'enriquecido',
    'fision',
    'plutonio',
    'uranio',
    'chernobyl',
    'geiger',
    'contencion',
    'bunker',
    'atomico',
    'termonuclear',
    'detonado',
    'vaporizado',
    'obliterado',
  ],
  fr: [
    'atomise',
    'decontamine',
    'desactive',
    'irradie',
    'sans-retombees',
    'fusion-nucleaire',
    'reacteur-propre',
    'demi-vie',
    'reaction-en-chaine',
    'point-zero',
    'masse-critique',
    'zone-de-tir',
    'ogive',
    'enrichi',
    'fission',
    'plutonium',
    'uranium',
    'tchernobyl',
    'geiger',
    'confinement',
    'bunker',
    'atomique',
    'thermonucleaire',
    'detone',
    'vaporise',
    'pulverise',
  ],
  de: [
    'genuked',
    'dekontaminiert',
    'entschaerft',
    'bestrahlt',
    'fallout-frei',
    'kernschmelze',
    'reaktor-sauber',
    'halbwertszeit',
    'kettenreaktion',
    'ground-zero',
    'kritische-masse',
    'sprengzone',
    'sprengkopf',
    'angereichert',
    'spaltung',
    'fusion',
    'plutonium',
    'uran',
    'tschernobyl',
    'geiger',
    'sicherheitsbehaelter',
    'bunker',
    'gefahrgut',
    'atomar',
    'thermonuklear',
    'gezuendet',
    'verdampft',
    'ausgeloescht',
  ],
  pt: [
    'nukeado',
    'descontaminado',
    'desarmado',
    'irradiado',
    'sem-fallout',
    'fusao-nuclear',
    'reator-limpo',
    'meia-vida',
    'reacao-em-cadeia',
    'marco-zero',
    'massa-critica',
    'zona-de-impacto',
    'ogiva',
    'enriquecido',
    'fissao',
    'plutonio',
    'uranio',
    'chernobyl',
    'geiger',
    'contencao',
    'bunker',
    'atomico',
    'termonuclear',
    'detonado',
    'vaporizado',
    'obliterado',
  ],
  zh: [
    'hebao',
    'jinghua',
    'paishe',
    'fushe',
    'ling-wuran',
    'ronghe',
    'fanying-qingjie',
    'ban-shuaiqi',
    'lianshi-fanying',
    'yuanbao-zhongxin',
    'linjie-zhiliang',
    'baozha-quyu',
    'dantou',
    'nongsu',
    'liebian',
    'jubian',
    'bu',
    'you',
    'qieernobeili',
    'gaige',
    'anquan-ke',
    'yanbi',
    'yuanzi',
    'renhe',
    'yinbao',
    'zhengfa',
    'huimie',
  ],
};

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

export function generateOutputFilename(
  inputName: string,
  format: ExportFormat = 'png',
  locale = 'en',
): string {
  const base = inputName.replace(/\.[^.]+$/, '');
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let prefix: string;
  const holidayPrefix = HOLIDAY_PREFIXES[monthDay];

  if (holidayPrefix && !holidayUsed) {
    prefix = holidayPrefix;
    holidayUsed = true;
  } else {
    const prefixes = NUKE_PREFIXES[locale] ?? NUKE_PREFIXES['en'];
    prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  }

  const ext = format === 'webp' ? 'webp' : 'png';
  return `${prefix}-${base}.${ext}`;
}
