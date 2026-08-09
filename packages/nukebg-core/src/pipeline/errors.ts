/**
 * Base error class for all nukebg-core errors.
 * Every error carries a discriminating `code` string (REQ-CORE-RUNNERS-5).
 */
export class NukebgError extends Error {
  readonly code: string;

  constructor(message: string, code: string, opts?: { cause?: unknown }) {
    super(message, opts as ErrorOptions);
    this.code = code;
    this.name = 'NukebgError';

    // Fix prototype chain for environments where extending built-ins breaks instanceof
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface ErrorSubclassOpts {
  cause?: unknown;
  /** Override the default code. */
  code?: string;
}

/**
 * Thrown when the RMBG segmentation model fails.
 * Default code: "RMBG_FAILED" (REQ-CORE-PIPELINE-4).
 */
export class RmbgError extends NukebgError {
  constructor(message: string, opts?: ErrorSubclassOpts) {
    super(message, opts?.code ?? 'RMBG_FAILED', opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'RmbgError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the LaMa inpainting model fails.
 * Default code: "LAMA_FAILED" (REQ-CORE-PIPELINE-4).
 */
export class LamaError extends NukebgError {
  constructor(message: string, opts?: ErrorSubclassOpts) {
    super(message, opts?.code ?? 'LAMA_FAILED', opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'LamaError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the codec cannot decode input bytes.
 * Default code: "DECODE_FAILED" (REQ-CORE-PIPELINE-4).
 */
export class DecodeError extends NukebgError {
  constructor(message: string, opts?: ErrorSubclassOpts) {
    super(message, opts?.code ?? 'DECODE_FAILED', opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'DecodeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an AbortSignal fires during pipeline execution.
 * code: "PIPELINE_ABORTED" (REQ-CORE-PIPELINE-4).
 * name: "AbortError" (REQ-CORE-PIPELINE-3 — spec requires error.name === "AbortError").
 */
export class PipelineAbortError extends NukebgError {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, 'PIPELINE_ABORTED', opts);
    this.name = 'AbortError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a stage, or the run as a whole, exceeds its time budget.
 *
 * Distinct from `PipelineAbortError`: an abort is the caller changing its
 * mind, a timeout is the pipeline failing to make progress. Callers branch on
 * them differently — a timeout is worth retrying, a user abort is not.
 *
 * code: "PIPELINE_TIMEOUT".
 */
export class PipelineTimeoutError extends NukebgError {
  /** Which budget was exceeded — a stage name, or "wall-clock". */
  readonly stage: string;
  /** The budget in milliseconds that was exceeded. */
  readonly timeoutMs: number;

  constructor(stage: string, timeoutMs: number, opts?: { cause?: unknown }) {
    super(`${stage} exceeded its ${timeoutMs}ms budget`, 'PIPELINE_TIMEOUT', opts);
    this.name = 'PipelineTimeoutError';
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
