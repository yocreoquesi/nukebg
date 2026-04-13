import JSZip from 'jszip';

export interface ZipFile {
  name: string;
  blob: Blob;
}

/**
 * Build a ZIP Blob from a list of files.
 * Uses DEFLATE level 6: good compression for PNGs that already contain
 * compressed pixel data, without burning CPU at level 9.
 */
export async function createZip(files: ZipFile[]): Promise<Blob> {
  if (files.length === 0) {
    throw new Error('createZip: empty file list');
  }
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.blob);
  }
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** Pad a 1-based index to a fixed width (e.g. 3 → "03" when total is 12) */
export function padIndex(index: number, total: number): string {
  const width = String(total).length;
  return String(index).padStart(width, '0');
}

/**
 * Derive a safe download filename from the original file name.
 * Replaces the extension with .png and strips characters that could cause
 * issues inside ZIP archives on some OSes.
 */
export function safeZipEntryName(index: number, total: number, originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const safeBase = base.slice(0, 60) || 'image';
  return `nukebg-${padIndex(index, total)}-${safeBase}.png`;
}

/** Trigger a browser download for the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
