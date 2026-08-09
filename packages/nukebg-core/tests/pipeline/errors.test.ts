import { describe, it, expect } from 'vitest';
import {
  NukebgError,
  RmbgError,
  LamaError,
  DecodeError,
  PipelineAbortError,
} from '../../src/pipeline/errors.js';

describe('Error classes (REQ-CORE-RUNNERS-5, REQ-CORE-PIPELINE-4)', () => {
  describe('NukebgError base class', () => {
    it('is an instance of Error', () => {
      const err = new NukebgError('test', 'TEST_CODE');
      expect(err).toBeInstanceOf(Error);
    });

    it('has a code property', () => {
      const err = new NukebgError('test message', 'MY_CODE');
      expect(err.code).toBe('MY_CODE');
    });

    it('has the correct message', () => {
      const err = new NukebgError('something went wrong', 'ERR');
      expect(err.message).toBe('something went wrong');
    });

    it('is an instance of NukebgError', () => {
      const err = new NukebgError('test', 'CODE');
      expect(err).toBeInstanceOf(NukebgError);
    });

    it('preserves cause via options', () => {
      const cause = new Error('original');
      const err = new NukebgError('wrapped', 'CODE', { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe('RmbgError', () => {
    it('is an instance of NukebgError (REQ-CORE-RUNNERS-5)', () => {
      const err = new RmbgError('rmbg failed');
      expect(err).toBeInstanceOf(NukebgError);
    });

    it('is an instance of Error', () => {
      const err = new RmbgError('rmbg failed');
      expect(err).toBeInstanceOf(Error);
    });

    it('has code "RMBG_FAILED" by default (REQ-CORE-PIPELINE-4)', () => {
      const err = new RmbgError('rmbg failed');
      expect(err.code).toBe('RMBG_FAILED');
    });

    it('preserves cause', () => {
      const cause = new Error('original runner error');
      const err = new RmbgError('rmbg failed', { cause });
      expect(err.cause).toBe(cause);
    });

    it('accepts a custom code override', () => {
      const err = new RmbgError('integrity check failed', { code: 'RMBG_INTEGRITY_FAILED' });
      expect(err.code).toBe('RMBG_INTEGRITY_FAILED');
    });
  });

  describe('LamaError', () => {
    it('is an instance of NukebgError (REQ-CORE-RUNNERS-5)', () => {
      const err = new LamaError('lama failed');
      expect(err).toBeInstanceOf(NukebgError);
    });

    it('has code "LAMA_FAILED" by default (REQ-CORE-PIPELINE-4)', () => {
      const err = new LamaError('lama failed');
      expect(err.code).toBe('LAMA_FAILED');
    });

    it('preserves cause', () => {
      const cause = new Error('network error');
      const err = new LamaError('download failed', { cause });
      expect(err.cause).toBe(cause);
    });

    it('accepts LAMA_DOWNLOAD_FAILED code', () => {
      const err = new LamaError('download failed', { code: 'LAMA_DOWNLOAD_FAILED' });
      expect(err.code).toBe('LAMA_DOWNLOAD_FAILED');
    });
  });

  describe('DecodeError', () => {
    it('is an instance of NukebgError (REQ-CORE-RUNNERS-5)', () => {
      const err = new DecodeError('cannot decode');
      expect(err).toBeInstanceOf(NukebgError);
    });

    it('has code "DECODE_FAILED" by default (REQ-CORE-PIPELINE-4)', () => {
      const err = new DecodeError('cannot decode');
      expect(err.code).toBe('DECODE_FAILED');
    });

    it('preserves cause', () => {
      const cause = new Error('raw decode error');
      const err = new DecodeError('decode failed', { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe('PipelineAbortError', () => {
    it('is an instance of NukebgError (REQ-CORE-RUNNERS-5)', () => {
      const err = new PipelineAbortError('aborted');
      expect(err).toBeInstanceOf(NukebgError);
    });

    it('has code "PIPELINE_ABORTED" (REQ-CORE-PIPELINE-4)', () => {
      const err = new PipelineAbortError('aborted');
      expect(err.code).toBe('PIPELINE_ABORTED');
    });

    it('has name "AbortError" (REQ-CORE-PIPELINE-3)', () => {
      const err = new PipelineAbortError('aborted');
      expect(err.name).toBe('AbortError');
    });
  });

  describe('instanceof NukebgError for ALL subclasses (REQ-CORE-RUNNERS-5)', () => {
    it('every subclass passes instanceof NukebgError check', () => {
      const errors = [
        new RmbgError('r'),
        new LamaError('l'),
        new DecodeError('d'),
        new PipelineAbortError('p'),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(NukebgError);
      }
    });
  });
});
