# NUKEBG

> Nuke backgrounds from any image. 100% client-side. Zero uploads. Zero BS.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Build](https://img.shields.io/github/actions/workflow/status/yocreoquesi/nukebg/ci.yml?branch=main)](https://github.com/yocreoquesi/nukebg/actions)
[![Tests](https://img.shields.io/badge/tests-vitest-green.svg)](https://vitest.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Client-Side](https://img.shields.io/badge/Processing-100%25%20Client--Side-green.svg)](#-privacy)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20NukeBG-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/yocreoquesi)

[Live Demo](https://nukebg.app) | [GitHub](https://github.com/yocreoquesi/nukebg) | [Support on Ko-fi](https://ko-fi.com/yocreoquesi)

---

## > what_is_this

```
$ nukebg --explain

Background removal tools are everywhere. Most of them suck at AI-generated images:
painted checkerboard patterns, baked-in watermarks, fake transparency.

NukeBG handles all of it. In your browser. On your device.
No uploads. No accounts. No tracking. Nothing leaves your machine.

Drop. Nuke. Download. That's it.
```

## > features

```
[+] BACKGROUND REMOVAL          ML-powered removal for any image: photos, illustrations,
                                AI art, whatever. RMBG-1.4 + MODNet. WebGPU/WASM.

[+] CHECKERBOARD OBLITERATION   Detects and classifies painted checkerboard backgrounds.
                                Any grid size, any generator.

[+] GEMINI WATERMARK REMOVAL    Auto-detects and inpaints Gemini's sparkle watermark.
                                Telea FMM reconstruction -- no blurry patches.

[+] 100% CLIENT-SIDE            Zero server uploads. Zero network requests during processing.
                                Verify it yourself in DevTools.

[+] DUAL ML MODELS              RMBG-1.4 (~45MB) for illustrations and AI art.
                                MODNet (~25MB) optimized for photos of people.

[+] OFFLINE MODE                After first visit, app + model weights are cached.
                                Process images without internet.

[+] OPEN SOURCE (GPL-3.0)       Audit the code. Fork it. Improve it.
```

## > quick_start

**Use online -- no install needed:**

```
$ open https://nukebg.app
```

**Run locally:**

```bash
$ git clone https://github.com/yocreoquesi/nukebg.git
$ cd nukebg
$ npm install
$ npm run dev        # dev server at localhost:5173
$ npm test           # run tests
$ npm run build      # production build -> dist/
```

Deploy `dist/` to any static host: Cloudflare Pages, GitHub Pages, Netlify, Vercel.

## > how_it_works

```
  INPUT (PNG, JPG, WebP)
    |
    v
  [1. DETECT BACKGROUND] ------ corner sampling, brightness analysis
    |                            classifies: checkerboard / solid / complex
    v
  [2. WATERMARK SCAN] --------- Gemini sparkle detection (runs on every image)
    |
    +-- Watermark found? ------> [3. INPAINT] Telea FMM reconstruction
    +-- No watermark? ----------> skip
    |
    v
  [4. ML SEGMENTATION] -------- RMBG-1.4 or MODNet (user's choice)
    |                            WebGPU preferred, WASM fallback
    v
  CLEAN RGBA PNG w/ REAL TRANSPARENCY
```

ML models are lazy-loaded on first use, then cached by the Service Worker for offline access.

## > tech_stack

| Layer | Technology |
|-------|-----------|
| Language | Vanilla TypeScript (no framework) |
| UI | Web Components (`<ar-dropzone>`, `<ar-viewer>`, `<ar-progress>`) |
| Build | Vite 6 |
| Testing | Vitest |
| ML Runtime | Transformers.js (ONNX Runtime Web) |
| ML Models | RMBG-1.4 INT8 (~45MB) + MODNet (~25MB) |
| GPU | WebGPU with WASM fallback |
| Processing | Canvas API + OffscreenCanvas in Web Workers |
| Caching | Service Worker + Cache API |
| Styling | Custom CSS (JetBrains Mono, zero dependencies) |

## > privacy

```
$ nukebg --privacy

NO server processing.    All image editing happens locally in Web Workers.
NO uploads.              Images never leave your device.
NO cookies.              Nothing is collected.
NO tracking.             No analytics. No telemetry.
NO accounts.             No sign-up required.
OFFLINE capable.         Works without internet after first visit.
OPEN SOURCE.             Don't trust us -- verify.
```

## > comparison

| Feature | NukeBG | remove.bg | backgroundless.io | Photoshop |
|---------|--------|-----------|-------------------|-----------|
| Checkerboard detection | Yes | No | No | Manual |
| Gemini watermark removal | Yes | No | No | Manual |
| ML background removal | Yes | Yes | Yes | Yes |
| Client-side (private) | Yes | No | Yes | N/A |
| Free and unlimited | Yes | No (credits) | Yes | No ($22/mo) |
| Open source | Yes (GPL-3.0) | No | No | No |
| Works offline | Yes | No | No | Yes |

## > contributing

```
$ cat CONTRIBUTING.md
```

Contributions welcome. Read the [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

[Report Bug](https://github.com/yocreoquesi/nukebg/issues/new?template=bug_report.md) | [Request Feature](https://github.com/yocreoquesi/nukebg/issues/new?template=feature_request.md)

## > support

If NukeBG saves you time, consider keeping it alive:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

Built with the assistance of AI agents (Claude by Anthropic).

**Built for creators who are done dealing with garbage backgrounds. Open source forever.**
