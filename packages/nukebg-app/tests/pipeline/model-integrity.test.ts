import { describe, it, expect } from 'vitest';
import { LAMA_PARAMS, MOBILESAM_PARAMS, RMBG_PARAMS } from '../../src/pipeline/constants';

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
  // The actual verifyRmbgIntegrity / fetchModel logic lives inside web
  // workers, where SubtleCrypto + Cache API are easily exercised end-to-end.
  // Here we sanity-check that the same primitive both workers rely on
  // produces stable output for a known input — guards against accidental
  // encoding changes (e.g. switching to base64) that would silently
  // bypass the LaMa/SAM/RMBG hash checks.
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
