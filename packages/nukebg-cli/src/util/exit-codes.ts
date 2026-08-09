// ---------------------------------------------------------------------------
// Exit code table (design §H.2 — LOCKED). Values MUST match verbatim.
//
// DEVIATION (documented, see apply-progress for Phase 16): `NO_INPUT: 66` is
// an ADDITIVE entry not present in design §H.2's locked object. It is
// required by REQ-CLI-INVOCATION-2 ("If the file does not exist, the CLI
// MUST exit 66 (EX_NOINPUT)") and REQ-CLI-INVOCATION-6's exit code table,
// both of which explicitly require a code distinct from USER_ERROR (64, bad
// flags/args) and INPUT_DECODE_FAILED (65, unreadable image bytes). No
// existing LOCKED value was changed or renumbered — this only adds a new
// field. Flagged for sdd-verify review.
// ---------------------------------------------------------------------------
export const ExitCode = Object.freeze({
  OK: 0,
  USER_ERROR: 64, // bad CLI args, invalid input path, malformed flag
  INPUT_DECODE_FAILED: 65, // sharp could not decode (corrupt/unsupported file)
  NO_INPUT: 66, // input file does not exist / is unreadable (REQ-CLI-INVOCATION-2, additive)
  PIPELINE_FAILED: 70, // CV/ML stage threw a non-recoverable error
  MODEL_DOWNLOAD_FAILED: 74, // network/integrity failure on RMBG or LaMa load
  IO_ERROR: 75, // fs read/write failure (permission denied, ENOSPC)
  LICENSE_REQUIRED: 78, // CC-BY-NC-4.0 not accepted
  ABORTED: 130, // SIGINT (Ctrl+C); matches POSIX convention 128 + signal 2
});

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
