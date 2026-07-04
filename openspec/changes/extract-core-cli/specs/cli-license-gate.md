# CLI License Gate Specification

## Purpose

RMBG-1.4 is licensed CC-BY-NC-4.0 (non-commercial use only). The `nukebg-cli` package MUST surface this constraint through multiple layers so that no user can claim they were unaware. The license gate governs first-run behavior, scripted/CI use, and the explicit `nukebg license` subcommand.

## Requirements

### REQ-CLI-LICENSE-1: First-run interactive prompt

**Statement**: On the first invocation of `nukebg <input>` (or any processing subcommand), if no accepted-license marker exists in the OS config directory, the CLI MUST:

1. Print a summary of the RMBG-1.4 CC-BY-NC-4.0 license to stderr.
2. Prompt interactively: `Do you accept non-commercial use only? [y/N]:`.
3. If the user answers `y` or `Y`, write the marker file and continue processing.
4. If the user answers anything else (including empty/Enter), exit 78 (`LICENSE_REQUIRED`, `EX_CONFIG`) with a clear message. (Reconciled from an earlier `exit 2` during `sdd-verify`, finding S4; the CLI exit-code table in cli-invocation.md and design §H.2 use 78.)

The marker file MUST be written to `<os-config-dir>/nukebg/accepted-license.json` with the following shape:

```json
{
  "version": 1,
  "acceptedAt": "<ISO-8601>",
  "acknowledged": "RMBG-1.4 CC-BY-NC-4.0"
}
```

#### Scenario: First-run accept

- GIVEN no marker file exists and the terminal is a TTY
- WHEN `nukebg image.png` is executed and the user enters `y`
- THEN the marker file is written to the config directory
- AND processing continues normally
- AND on the next invocation the prompt is NOT shown again

#### Scenario: First-run reject

- GIVEN no marker file exists and the terminal is a TTY
- WHEN `nukebg image.png` is executed and the user presses Enter (default `N`)
- THEN the process exits 2
- AND the marker file is NOT created
- AND the error message references the CC-BY-NC-4.0 license on stderr

---

### REQ-CLI-LICENSE-2: `--accept-non-commercial` flag for non-TTY / CI

**Statement**: When `--accept-non-commercial` is passed on the command line, the CLI MUST behave as if the user accepted the prompt, even in non-TTY environments. The marker file MUST be written if it does not already exist. This flag MUST be documented in `--help` output with a note that it is required for CI/scripted use.

#### Scenario: CI pipeline without marker

- GIVEN the marker file does not exist and stdin is not a TTY
- WHEN `nukebg image.png --accept-non-commercial` is run in a CI environment
- THEN the marker file is written
- AND processing continues and exits 0 on success

#### Scenario: Non-TTY without flag exits 2

- GIVEN the marker file does not exist and stdin is not a TTY
- WHEN `nukebg image.png` is run without `--accept-non-commercial`
- THEN the process exits 2 immediately with a message explaining the flag is required

---

### REQ-CLI-LICENSE-3: Marker file check on every invocation

**Statement**: Before invoking any pipeline logic, the CLI MUST check for the marker file. If the marker file exists and is valid JSON with `acknowledged === "RMBG-1.4 CC-BY-NC-4.0"` and `version === 1`, processing proceeds without a prompt. If the file is malformed or has an unexpected version, the CLI MUST treat it as absent and re-prompt (or exit 78 `LICENSE_REQUIRED` on non-TTY).

#### Scenario: Valid marker present — no prompt

- GIVEN a valid marker file exists in the config directory
- WHEN `nukebg image.png` is executed
- THEN no license prompt is shown and processing proceeds immediately

#### Scenario: Corrupted marker file triggers re-prompt

- GIVEN the marker file contains invalid JSON
- WHEN `nukebg image.png` is executed in a TTY
- THEN the license prompt is displayed as if the marker did not exist

---

### REQ-CLI-LICENSE-4: `nukebg license` subcommand

**Statement**: The `nukebg license` subcommand MUST print:

1. The current acceptance status (`accepted` / `not accepted`).
2. If accepted: the `acceptedAt` timestamp and the `acknowledged` string.
3. The full RMBG-1.4 CC-BY-NC-4.0 license notice (URL is acceptable in lieu of full text in v1).

`nukebg license --revoke` MUST delete the marker file and print a confirmation. After revocation, the next `nukebg` processing invocation MUST re-prompt (or exit 78 `LICENSE_REQUIRED` on non-TTY). `nukebg license` MUST exit 0 in all cases unless a filesystem error occurs, in which case it exits 1.

#### Scenario: Print accepted status

- GIVEN the marker file exists
- WHEN `nukebg license` is executed
- THEN stdout contains `Status: accepted`, the acceptance timestamp, and the CC-BY-NC-4.0 notice

#### Scenario: Print not-accepted status

- GIVEN no marker file exists
- WHEN `nukebg license` is executed
- THEN stdout contains `Status: not accepted` and exits 0

#### Scenario: Revoke acceptance

- GIVEN the marker file exists
- WHEN `nukebg license --revoke` is executed
- THEN the marker file is deleted
- AND stdout confirms revocation
- AND a subsequent `nukebg image.png` invocation in non-TTY exits 2

---

### REQ-CLI-LICENSE-5: README banner

**Statement**: The `packages/nukebg-cli/README.md` MUST contain a prominently placed section (before any usage examples) with the following content:

- A warning that this CLI uses the RMBG-1.4 model under CC-BY-NC-4.0.
- A statement that commercial use requires a separate license from BRIA AI.
- A link to `https://bria.ai/bria-huggingface-model-license-agreement/` or the canonical BRIA AI licensing page.

This requirement is verified at publish time, not at runtime. It is listed here so that `sdd-verify` can check the README before marking the change complete.

#### Scenario: README contains license warning

- GIVEN the `packages/nukebg-cli/README.md` file is read
- WHEN the content is scanned for the RMBG-1.4 license notice
- THEN the text "CC-BY-NC-4.0" and a BRIA AI license URL are both present before the first code block
