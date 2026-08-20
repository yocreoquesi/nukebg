# nukebg-cli

Remove backgrounds from images from the command line. Node-only, no browser required.

## License notice (read this first)

**`nukebg-cli` uses the RMBG-1.4 background-removal model, which is licensed under
CC-BY-NC-4.0 — non-commercial use only.**

Commercial use (paid products, paid APIs, paid SaaS, ad-supported products) requires
a separate commercial license from BRIA AI. The GPL-3.0 license of `nukebg-cli`'s own
code does **not** override this. See the model card and license terms at
[BRIA RMBG-1.4 on Hugging Face](https://huggingface.co/briaai/RMBG-1.4) or the
[BRIA AI licensing page](https://bria.ai/bria-huggingface-model-license-agreement/).

The CLI enforces this at runtime: on first use it prompts for explicit acceptance
(or requires `--accept-non-commercial` in non-interactive environments) before any
image is processed. See [License gate](#license-gate) below.

## Install

```bash
npm install -g nukebg-cli
```

Requires Node.js 22.12 or newer. Installs the `nukebg` binary.

## Usage

```bash
nukebg <input> [options]
nukebg license [--revoke]
```

### Quick path

```bash
# Accept the license once, interactively
nukebg photo.png
# Accept non-commercial use only? [y/N] y

# Every run after that just works
nukebg another-photo.jpg
# -> another-photo.nukebg.png written next to the input
```

### Options

| Flag | Default | Description |
| --- | --- | --- |
| `-o, --output <path>` | `<stem>.nukebg.<format>` next to the input | Explicit output file path. |
| `-f, --format <png\|webp>` | `png` (or inferred from `-o`'s extension) | Output image format. |
| `--mode <photo\|signature\|icon\|auto>` | `auto` | Force a content-type path instead of letting the classifier decide. |
| `--precision <low\|normal\|high\|ultra>` | `normal` | Trade speed for edge/mask quality. |
| `--no-watermark` | watermark detection on | Skip watermark detection and inpainting entirely. |
| `--cache-dir <path>` | see [Model cache](#model-cache) | Override where downloaded models are cached. |
| `--accept-non-commercial` | off | Acknowledge RMBG-1.4's CC-BY-NC-4.0 non-interactively. Required for CI/scripted use. |
| `--json` | off | Emit line-delimited JSON events on stdout. **Deferred**: accepted by the parser in v1 but has no effect yet — output is unchanged. Full JSON event streaming ships in v1.1. |
| `-q, --quiet` | off | Suppress non-error stderr output. |
| `-v, --verbose` | off | Print per-stage timings to stderr. |
| `-h, --help` | — | Print usage and exit. |
| `--version` | — | Print the installed version and exit. |

### Examples

```bash
# Explicit output path
nukebg photo.png -o result.png

# WebP output (format inferred from the extension)
nukebg photo.png -o result.webp

# Explicit format flag wins over the -o extension
nukebg photo.png -o result.png -f webp

# Icon artwork at maximum precision, skip watermark handling
nukebg logo.png --mode icon --precision ultra --no-watermark

# CI / non-interactive: must pass --accept-non-commercial or the run exits 78
nukebg photo.png --accept-non-commercial --quiet

# Verbose timings on stderr
nukebg photo.png --verbose
```

### Exit codes

`nukebg` follows `sysexits.h` conventions where they fit. Scripts and CI pipelines
should branch on these codes rather than parsing stderr text.

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | `OK` | Success. |
| `64` | `USER_ERROR` | Bad CLI arguments — unrecognized flag, invalid choice value, missing required `<input>`. |
| `65` | `INPUT_DECODE_FAILED` | The input file exists but could not be decoded as an image (corrupt or unsupported bytes). |
| `66` | `NO_INPUT` | The input file does not exist or is unreadable. |
| `70` | `PIPELINE_FAILED` | A CV/ML pipeline stage threw a non-recoverable error. |
| `74` | `MODEL_DOWNLOAD_FAILED` | RMBG-1.4 or LaMa model download/integrity check failed. |
| `75` | `IO_ERROR` | Filesystem read/write failure (permission denied, disk full). |
| `78` | `LICENSE_REQUIRED` | RMBG-1.4's CC-BY-NC-4.0 has not been accepted — see [License gate](#license-gate). |
| `130` | `ABORTED` | Interrupted with Ctrl+C (`SIGINT`). |

> Note: exit code `66` (`NO_INPUT`) is an addition on top of the original design's
> locked exit table, needed to distinguish "file does not exist" (66) from "bad
> flags" (64) and "unreadable image bytes" (65). It does not change any other code.

## License gate

RMBG-1.4, the background-removal model this CLI depends on, is licensed
**CC-BY-NC-4.0 — non-commercial use only**. `nukebg-cli` will not run the
pipeline until that has been explicitly acknowledged.

- **First run, interactive terminal**: the CLI prints the license summary to
  stderr and prompts `Accept non-commercial use? [y/N]`. Answering `y`/`Y` writes
  an acceptance marker to your OS config directory and processing continues.
  Anything else (including pressing Enter) exits `78`.
- **CI / scripted / non-TTY**: there is no terminal to prompt, so you must pass
  `--accept-non-commercial` explicitly. Without it, the CLI exits `78`
  immediately with a message pointing at the flag.
- **Subsequent runs**: once the marker file exists, no prompt is shown again.

Check or change your acceptance status at any time:

```bash
nukebg license            # prints Status: accepted|not accepted, timestamp, license notice
nukebg license --revoke   # deletes the acceptance marker; next run re-prompts
```

### Model cache

Downloaded model weights (RMBG-1.4, LaMa) are cached on disk so they are only
fetched once. Resolution order:

1. `--cache-dir <path>` (explicit override)
2. `TRANSFORMERS_CACHE` environment variable
3. `HF_HOME` environment variable
4. OS-appropriate default cache directory (e.g. `~/.cache/nukebg` on Linux)

## Supported platforms

Verified in CI on:

- Linux x64
- macOS arm64
- Windows x64

macOS x64 and Linux arm64 are not covered by CI today and are untested — they
should work (all native dependencies ship prebuilt binaries for those
architectures) but are not verified on every release.

## Programmatic use

`nukebg-cli` is a thin Node-specific shell around
[`nukebg-core`](https://www.npmjs.com/package/nukebg-core), which is
runtime-agnostic and has zero runtime dependencies. If you want to embed
background removal in your own Node application instead of shelling out to
this CLI, depend on `nukebg-core` directly and provide your own runner
implementations — see the
[`nukebg-core` README](https://github.com/yocreoquesi/nukebg/tree/main/packages/nukebg-core#readme)
for the embedding example.
