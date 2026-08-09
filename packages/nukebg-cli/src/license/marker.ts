import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';

// ---------------------------------------------------------------------------
// LicenseMarker
// ---------------------------------------------------------------------------
//
// Persists the user's acknowledgement of the RMBG-1.4 CC-BY-NC-4.0 license
// (design §G.1, §G.2) to `<os-config-dir>/nukebg/accepted-license.json`.
// All fs access goes through injectable seams so this module is unit-testable
// without touching the real filesystem.

/** Free-form acknowledgement string written into the marker for human verification. */
export const ACKNOWLEDGED_TEXT = 'RMBG-1.4 CC-BY-NC-4.0' as const;

export interface LicenseMarker {
  /** Schema version. Bump when format changes. v1 = current. */
  readonly version: 1;
  /** ISO 8601 timestamp of acceptance. */
  readonly acceptedAt: string;
  /** Free-form acknowledgement string for human verification. */
  readonly acknowledged: typeof ACKNOWLEDGED_TEXT;
  /** CLI version that wrote the marker, for diagnostics. */
  readonly cliVersion: string;
}

export interface MarkerIoOptions {
  readFileImpl?: (path: string) => Promise<string>;
  writeFileImpl?: (path: string, data: string) => Promise<void>;
  renameImpl?: (oldPath: string, newPath: string) => Promise<void>;
  unlinkImpl?: (path: string) => Promise<void>;
  mkdirImpl?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
}

/** Absolute path to the marker file in the OS config directory (design §G.1). */
export function markerPath(): string {
  return join(envPaths('nukebg', { suffix: '' }).config, 'accepted-license.json');
}

function isValidMarker(value: unknown): value is LicenseMarker {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.acceptedAt === 'string' &&
    candidate.acknowledged === ACKNOWLEDGED_TEXT &&
    typeof candidate.cliVersion === 'string'
  );
}

/**
 * Read and validate the marker file. Returns `null` when the file is
 * missing, malformed JSON, or fails schema validation (wrong `version` or
 * `acknowledged`) — callers treat all of these as "not accepted"
 * (REQ-CLI-LICENSE-3).
 */
export async function readMarker(opts?: MarkerIoOptions): Promise<LicenseMarker | null> {
  const readFileImpl = opts?.readFileImpl ?? ((path: string) => readFile(path, 'utf8'));

  let raw: string;
  try {
    raw = await readFileImpl(markerPath());
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return isValidMarker(parsed) ? parsed : null;
}

/**
 * Write the marker file atomically: write to a `.tmp` sibling then rename it
 * into place, so a crash mid-write never leaves a torn/partial marker file
 * (design §G.2).
 */
export async function writeMarker(marker: LicenseMarker, opts?: MarkerIoOptions): Promise<void> {
  const writeFileImpl = opts?.writeFileImpl ?? ((path: string, data: string) => writeFile(path, data, 'utf8'));
  const renameImpl = opts?.renameImpl ?? rename;
  const mkdirImpl = opts?.mkdirImpl ?? mkdir;

  const finalPath = markerPath();
  const tmpPath = `${finalPath}.tmp`;

  // The OS config directory does not exist on a fresh machine — ensure it
  // does before writing the temp file (not shown in design §G.2's simplified
  // snippet, but required for the atomic write to succeed on first run).
  await mkdirImpl(dirname(finalPath), { recursive: true });
  await writeFileImpl(tmpPath, JSON.stringify(marker, null, 2));
  await renameImpl(tmpPath, finalPath);
}

/** Delete the marker file. Silently succeeds if it does not already exist. */
export async function deleteMarker(opts?: MarkerIoOptions): Promise<void> {
  const unlinkImpl = opts?.unlinkImpl ?? unlink;

  try {
    await unlinkImpl(markerPath());
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') throw cause;
  }
}
