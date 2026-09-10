import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { LAMA_PARAMS, MOBILESAM_PARAMS, RMBG_PARAMS } from 'nukebg-core';

/**
 * Supply-chain hardening (#132): every model loaded by the app must be
 * pinned to a specific revision SHA AND have a SHA-256 hash recorded.
 * This test guards against:
 *   - Accidentally bumping the URL revision without bumping the hash
 *   - Accidentally bumping the hash without bumping the size
 *   - Accidentally serving a model from `main` (mutable upstream branch)
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REV_SHA = /^[0-9a-f]{40}$/;

describe('model integrity constants (#132)', () => {
  describe('LAMA_PARAMS (baseline pattern)', () => {
    it('URL is pinned to a 40-hex commit SHA, not `main`', () => {
      expect(LAMA_PARAMS.MODEL_URL).not.toMatch(/\/resolve\/main\//);
      const m = LAMA_PARAMS.MODEL_URL.match(/\/resolve\/([0-9a-f]+)\//);
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(REV_SHA);
    });
    it('EXPECTED_SHA256 is a 64-char lowercase hex string', () => {
      expect(LAMA_PARAMS.EXPECTED_SHA256).toMatch(SHA256_HEX);
    });
    it('EXPECTED_SIZE is a positive integer', () => {
      expect(LAMA_PARAMS.EXPECTED_SIZE).toBeGreaterThan(0);
      expect(Number.isInteger(LAMA_PARAMS.EXPECTED_SIZE)).toBe(true);
    });
  });

  describe('MOBILESAM_PARAMS', () => {
    it('REVISION is a 40-hex commit SHA', () => {
      expect(MOBILESAM_PARAMS.REVISION).toMatch(REV_SHA);
    });
    it('encoder URL is pinned to MOBILESAM_PARAMS.REVISION (not `main`)', () => {
      expect(MOBILESAM_PARAMS.ENCODER_URL).toContain(`/resolve/${MOBILESAM_PARAMS.REVISION}/`);
      expect(MOBILESAM_PARAMS.ENCODER_URL).not.toMatch(/\/resolve\/main\//);
    });
    it('decoder URL is pinned to MOBILESAM_PARAMS.REVISION (not `main`)', () => {
      expect(MOBILESAM_PARAMS.DECODER_URL).toContain(`/resolve/${MOBILESAM_PARAMS.REVISION}/`);
      expect(MOBILESAM_PARAMS.DECODER_URL).not.toMatch(/\/resolve\/main\//);
    });
    it('encoder + decoder SHA-256 are 64-char lowercase hex strings', () => {
      expect(MOBILESAM_PARAMS.ENCODER_SHA256).toMatch(SHA256_HEX);
      expect(MOBILESAM_PARAMS.DECODER_SHA256).toMatch(SHA256_HEX);
    });
    it('encoder + decoder sizes are positive integers', () => {
      expect(MOBILESAM_PARAMS.ENCODER_SIZE).toBeGreaterThan(0);
      expect(MOBILESAM_PARAMS.DECODER_SIZE).toBeGreaterThan(0);
      expect(Number.isInteger(MOBILESAM_PARAMS.ENCODER_SIZE)).toBe(true);
      expect(Number.isInteger(MOBILESAM_PARAMS.DECODER_SIZE)).toBe(true);
    });
  });

  describe('RMBG_PARAMS', () => {
    it('REVISION is a 40-hex commit SHA', () => {
      expect(RMBG_PARAMS.REVISION).toMatch(REV_SHA);
    });
    it('MODEL_URL is pinned to RMBG_PARAMS.REVISION (not `main`)', () => {
      expect(RMBG_PARAMS.MODEL_URL).toContain(`/resolve/${RMBG_PARAMS.REVISION}/`);
      expect(RMBG_PARAMS.MODEL_URL).not.toMatch(/\/resolve\/main\//);
    });
    it('MODEL_URL points at the q8 quantized ONNX (matches transformers.js dtype)', () => {
      expect(RMBG_PARAMS.MODEL_URL).toMatch(/onnx\/model_quantized\.onnx$/);
    });
    it('EXPECTED_SHA256 is a 64-char lowercase hex string', () => {
      expect(RMBG_PARAMS.EXPECTED_SHA256).toMatch(SHA256_HEX);
    });
    it('EXPECTED_SIZE is a positive integer', () => {
      expect(RMBG_PARAMS.EXPECTED_SIZE).toBeGreaterThan(0);
      expect(Number.isInteger(RMBG_PARAMS.EXPECTED_SIZE)).toBe(true);
    });
    it('CACHE_NAME is the @huggingface/transformers v3 default', () => {
      expect(RMBG_PARAMS.CACHE_NAME).toBe('transformers-cache');
    });
  });
});

describe('SHA-256 verification primitive (web crypto)', () => {
  // Sanity-checks that the primitive the hash checks rely on produces stable
  // output for a known input — guards against an accidental encoding change
  // (e.g. switching to base64) that would silently bypass LaMa/SAM/RMBG.
  //
  // This comment used to say the verification logic "lives inside web
  // workers, where SubtleCrypto + Cache API are easily exercised end-to-end".
  // Neither half held: it was never exercised, and being unreachable from a
  // test is part of how #397 happened — a control nobody can call in
  // isolation is a control nobody notices is missing from the other path.
  // RMBG's now lives in src/lib/verify-rmbg-integrity.ts and is tested
  // directly in tests/lib/verify-rmbg-integrity.test.ts. LaMa and SAM still
  // verify inline in their own workers.
  it('SHA-256 of the empty buffer is deterministic + lowercase hex', async () => {
    const empty = new Uint8Array(0);
    const digest = await crypto.subtle.digest('SHA-256', empty);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('SHA-256 of "hello" matches the well-known reference vector', async () => {
    const data = new TextEncoder().encode('hello');
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

/**
 * The constants above are only worth having if every download path uses
 * them (#397).
 *
 * They did not. `ml.worker.ts` verified its download against
 * RMBG_PARAMS; `refine/loaders/rmbg14.ts` — reached from the advanced
 * editor's Reprocess / Crop / Refine buttons — downloaded the same weights,
 * verified nothing, and restated the revision as its own literal. The
 * constants were correct the whole time. Nothing checked they were reached.
 *
 * These tests are deliberately written over the source tree rather than
 * against the two known files, so a third loader added later is covered
 * without anyone remembering to come back here.
 */

const SRC = resolve(__dirname, '..', '..', 'src');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SOURCES = tsFilesUnder(SRC).map((f) => ({
  // Windows path separators, so the names below read the same on any OS.
  name: f
    .slice(SRC.length + 1)
    .split(sep)
    .join('/'),
  text: readFileSync(f, 'utf8'),
}));

describe('every RMBG download path is verified (#397)', () => {
  const loaders = SOURCES.filter(
    (f) => /transformers\.pipeline\(/.test(f.text) && /image-segmentation/.test(f.text),
  );

  it('finds the loaders at all — a zero here would make the next test vacuous', () => {
    expect(loaders.map((f) => f.name).sort()).toEqual([
      'refine/loaders/rmbg14.ts',
      'workers/ml.worker.ts',
    ]);
  });

  it.each(loaders.map((f) => f.name))('%s verifies what it downloaded', (name) => {
    const file = loaders.find((f) => f.name === name)!;
    expect(file.text).toMatch(/verifyRmbgIntegrity\(/);
  });

  it('no source outside the constants restates the pinned revision', () => {
    // A second copy of the revision can drift from the one the audited
    // EXPECTED_SHA256 belongs to, and then the check can only ever reject.
    const offenders = SOURCES.filter((f) => f.text.includes(RMBG_PARAMS.REVISION)).map(
      (f) => f.name,
    );
    expect(offenders, `import RMBG_PARAMS.REVISION instead of hardcoding it`).toEqual([]);
  });
});
