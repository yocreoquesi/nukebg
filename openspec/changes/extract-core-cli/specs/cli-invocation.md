# CLI Invocation Specification

## Purpose

`nukebg-cli` provides the `nukebg` command-line binary. This spec defines the complete CLI surface: arguments, flags, file resolution, stdin/stdout behavior, progress output, and exit codes. It is the contract that `sdd-verify` will check against.

## Requirements

### REQ-CLI-INVOCATION-1: Command structure

**Statement**: The `nukebg` binary MUST support the following top-level commands and options:

```
nukebg <input> [options]    — process a single image
nukebg license [--revoke]   — manage license acceptance
nukebg --version            — print package version and exit 0
nukebg --help               — print usage and exit 0
```

`<input>` is a required positional for the image sub-command. All other flags are optional. Unrecognized flags MUST cause exit code 64 (`EX_USAGE`) with a usage message on stderr.

#### Scenario: Happy-path single image

- GIVEN `test.png` exists in the working directory
- WHEN `nukebg test.png` is executed (license already accepted)
- THEN the process exits 0
- AND `test.nukebg.png` is written in the same directory as the input file
- AND any progress messages are emitted on stderr

#### Scenario: Unrecognized flag

- GIVEN the user runs `nukebg test.png --not-a-flag`
- WHEN the binary parses arguments
- THEN it exits 64 (`EX_USAGE`) and prints a usage error to stderr

---

### REQ-CLI-INVOCATION-2: Input file resolution

**Statement**: The `<input>` positional MUST be resolved as a file path relative to the current working directory. The CLI MUST detect the image format by reading the file's magic bytes, not by trusting the file extension. Supported formats MUST include PNG, JPEG, and WebP. If the file does not exist, the CLI MUST exit 66 (`EX_NOINPUT`) with a descriptive message. If the file exists but is not a recognized image format, the CLI MUST exit 65 (`EX_DATAERR`).

#### Scenario: JPEG input detected by magic bytes despite wrong extension

- GIVEN a JPEG file saved as `image.png`
- WHEN `nukebg image.png` is executed
- THEN the CLI detects the JPEG magic bytes and decodes it correctly
- AND processing proceeds without error

#### Scenario: File does not exist

- GIVEN `missing.png` does not exist
- WHEN `nukebg missing.png` is executed
- THEN the process exits 66 (`EX_NOINPUT`) with a message referencing the path on stderr

#### Scenario: File is not an image

- GIVEN `document.txt` contains plain text
- WHEN `nukebg document.txt` is executed
- THEN the process exits 65 (`EX_DATAERR`) with a message indicating decode failure

---

### REQ-CLI-INVOCATION-3: Output path and default naming

**Statement**: The `-o / --output <path>` option specifies the output file path. If omitted, the output MUST be written to `<input-stem>.nukebg.png` in the same directory as the input file, where `<input-stem>` is the input filename without its extension. The default format is PNG. If `-o` ends with `.webp` or `--format webp` is specified, the output MUST be a WebP file.

#### Scenario: Default output path

- GIVEN input is `/photos/cat.jpg` and no `-o` is provided
- WHEN `nukebg /photos/cat.jpg` is executed
- THEN the output is written to `/photos/cat.nukebg.png`

#### Scenario: Explicit output path

- GIVEN the user runs `nukebg cat.jpg -o result.png`
- WHEN processing succeeds
- THEN `result.png` is written and the default path is NOT created

#### Scenario: WebP output via format flag

- GIVEN the user runs `nukebg cat.jpg --format webp`
- WHEN processing succeeds
- THEN the output file starts with the RIFF/WEBP magic bytes

---

### REQ-CLI-INVOCATION-4: Stdin input

**Statement**: When `<input>` is `-`, the CLI MUST read image bytes from stdin. The format MUST be detected by magic bytes on the first bytes read. Stdin input MUST be fully buffered before processing begins. If stdin is empty or produces no recognizable image bytes, the CLI MUST exit 65 (`EX_DATAERR`).

**Note**: v1 supports stdin input (`nukebg -`). Streaming partial reads mid-pipeline are deferred to v1.1.

#### Scenario: Piped PNG via stdin

- GIVEN a valid PNG is piped: `cat image.png | nukebg - -o result.png`
- WHEN the CLI reads stdin to completion
- THEN it detects PNG format, processes the image, writes `result.png`, and exits 0

#### Scenario: Stdout output via `-o -`

- GIVEN the user runs `nukebg image.png -o -`
- WHEN processing succeeds
- THEN the PNG bytes of the result are written to stdout
- AND no progress output is emitted to stdout (progress goes to stderr only)

#### Scenario: Empty stdin

- GIVEN nothing is piped: `echo -n "" | nukebg -`
- WHEN the CLI reads stdin
- THEN it exits 65 (`EX_DATAERR`) with a decode-failure message on stderr

---

### REQ-CLI-INVOCATION-5: Pipeline mode and precision flags

**Statement**: The CLI MUST support:

- `--mode <photo|signature|icon|auto>` — default `auto`
- `--precision <low|normal|high|ultra>` — default `normal`
- `--no-watermark` — skip watermark detection + LaMa inpainting
- `--no-auto-crop` — skip auto-crop

When `--mode auto` is used, the pipeline MUST invoke the content classifier. The resolved mode MUST be logged to stderr in non-quiet mode.

#### Scenario: Explicit mode override

- GIVEN `nukebg logo.png --mode icon --precision high`
- WHEN the pipeline runs
- THEN it uses `mode = "icon"` and `precision = "high"` exactly as supplied, without classifier invocation

#### Scenario: `--no-watermark` skips LaMa

- GIVEN `nukebg photo.png --no-watermark`
- WHEN the pipeline runs
- THEN no LaMa model is loaded or invoked
- AND the output still has background removed

---

### REQ-CLI-INVOCATION-6: Exit code contract

**Statement**: The CLI MUST exit with sysexits-aligned codes (BSD `sysexits.h`):

| Code | sysexits name | Meaning |
|------|---------------|---------|
| `0` | `EX_OK` | Success — output written |
| `64` | `EX_USAGE` | Bad arguments — unrecognized flag, missing required positional, malformed value |
| `65` | `EX_DATAERR` | Input data is invalid — decode failed, unsupported image format, corrupt bytes |
| `66` | `EX_NOINPUT` | Cannot open input — file does not exist or is unreadable |
| `70` | `EX_SOFTWARE` | Internal pipeline failure — unexpected error during processing |
| `74` | `EX_IOERR` | I/O failure — model download failed after retries, output write failed |
| `75` | `EX_TEMPFAIL` | Temporary failure — retryable transient condition |
| `78` | `EX_CONFIG` | License not accepted — user declined, or non-TTY without `--accept-non-commercial` |
| `130` | (SIGINT, 128 + 2) | User interrupted (Ctrl-C) during processing |

No other exit codes are permissible in v1. The CLI MUST NOT exit 0 if the output was not written.

#### Scenario: Success exits 0

- GIVEN valid input and accepted license
- WHEN `nukebg input.png` exits
- THEN the exit code is exactly 0 and the output file exists

#### Scenario: Model download failure exits 74

- GIVEN the RMBG model cannot be downloaded (network error after all retries)
- WHEN `nukebg input.png` is executed
- THEN the process exits 74 (`EX_IOERR`) with a descriptive message on stderr

#### Scenario: SIGINT exits 130

- GIVEN `nukebg input.png` is processing
- WHEN the user sends SIGINT (Ctrl-C)
- THEN the process exits 130 and any partial output file is removed or left untouched (never half-written)

---

### REQ-CLI-INVOCATION-7: Progress output

**Statement**: Progress MUST be emitted to stderr only. Stdout is reserved exclusively for image bytes when `-o -` is used. In default mode, the CLI MUST emit at least one line per major stage (decode, watermark, RMBG, inpaint, finalize). `--quiet` suppresses all progress. `--verbose` adds timing information per stage. `--json` is deferred to v1.1.

#### Scenario: Quiet mode produces no output on success

- GIVEN `nukebg input.png -q`
- WHEN processing completes successfully
- THEN stderr is empty and only the output file is produced

#### Scenario: Verbose mode includes timings

- GIVEN `nukebg input.png --verbose`
- WHEN processing completes
- THEN stderr contains at least one timing line (e.g., `rmbg: 1234ms`)
