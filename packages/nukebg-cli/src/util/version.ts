import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve nukebg-cli's own package.json version (tasks.md 16.5-16.6).
//
// Build-safe by construction: rather than a single hardcoded relative path
// (fragile across `src/util/version.ts` executed directly via tsx vs. a
// future bundled `dist/cli.js` at a different depth under the package root
// — tsup.config.ts is Phase 19, not created yet), this walks UP from the
// module's own location until it finds a `package.json` whose `name` is
// "nukebg-cli". That directory depth is bundler-independent.
// ---------------------------------------------------------------------------

export interface VersionOptions {
  /** Directory to start the upward search from. Defaults to this module's own directory. */
  readonly startDir?: string;
  readonly readFileImpl?: (path: string) => string;
  readonly existsImpl?: (path: string) => boolean;
}

const MAX_WALK_UP = 12;

export function resolveVersion(opts?: VersionOptions): string {
  const readFileImpl = opts?.readFileImpl ?? ((p: string) => readFileSync(p, 'utf8'));
  const existsImpl = opts?.existsImpl ?? existsSync;
  const initialDir = opts?.startDir ?? dirname(fileURLToPath(import.meta.url));

  let dir = initialDir;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const candidate = join(dir, 'package.json');
    if (existsImpl(candidate)) {
      const parsed = JSON.parse(readFileImpl(candidate)) as { name?: string; version?: string };
      if (parsed.name === 'nukebg-cli' && typeof parsed.version === 'string') {
        return parsed.version;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not resolve nukebg-cli package version: no package.json named "nukebg-cli" found while walking up from ${initialDir}`,
  );
}
