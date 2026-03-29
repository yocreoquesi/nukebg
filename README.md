# NUKEBG

> Nuke backgrounds from any image. 100% client-side. Zero uploads. Zero BS.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Client-Side](https://img.shields.io/badge/Processing-100%25%20Client--Side-green.svg)](#-privacy)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20NukeBG-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/yocreoquesi)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=github-sponsors&logoColor=white)](https://github.com/sponsors/yocreoquesi)

[Use NukeBG](https://nukebg.app) | [GitHub](https://github.com/yocreoquesi/nukebg) | [Sponsor](https://github.com/sponsors/yocreoquesi) | [Ko-fi](https://ko-fi.com/yocreoquesi)

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
[+] ML BACKGROUND REMOVAL       RMBG-1.4 for segmentation with auto-classification.
                                  Photos, illustrations, signatures, icons. Each optimized.

[+] CHECKERBOARD OBLITERATION    Detects and classifies painted checkerboard backgrounds.
                                  Any grid size, any generator.

[+] WATERMARK REMOVAL            Auto-detects Gemini sparkle + DALL-E color bar watermarks.
                                  Telea FMM reconstruction -- no blurry patches.

[+] 100% CLIENT-SIDE             Zero server uploads. Zero network requests during processing.
                                  Verify it yourself in DevTools.

[+] OFFLINE MODE                 After first visit, app + model weights are cached.
                                  Process images without internet.

[+] TERMINAL THEME               JetBrains Mono, CRT effects, easter eggs everywhere.
                                  Slider with 4 visual modes. Type 'help' in the prompt.

[+] i18n                         EN, ES, FR, DE, PT, ZH. Auto-detects browser language.

[+] OPEN SOURCE (GPL-3.0)        Audit the code. Fork it. Improve it.
```

## > quick_start

**Use it now at [nukebg.app](https://nukebg.app) -- no install needed.**

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
  [1. CLASSIFY + SCAN] ---------- auto-detect content type + background (CV, instant)
    |                              PHOTO / ILLUSTRATION / SIGNATURE / ICON
    |
    +-- SIGNATURE? -------------> [CV threshold] Otsu + Sauvola (<50ms) --> DONE
    |
    +-- ICON? ------------------> [RMBG threshold 0.3] skip watermark --> DONE
    |
    +-- PHOTO / ILLUSTRATION? --> continue
    |
    v
  [2. WATERMARK DETECTION] ------ Gemini sparkle + DALL-E color bar (CV, instant)
    |
    +-- Watermark found? -------> [3. INPAINT] Telea FMM reconstruction (CV, instant)
    +-- No watermark? ----------> skip
    |
    v
  [4. BACKGROUND REMOVAL] ------- RMBG-1.4 segmentation (ML)
    |                              WebGPU/WASM via Transformers.js
    v
  CLEAN RGBA PNG w/ REAL TRANSPARENCY
```

The ML model is lazy-loaded on first use, then cached by the Service Worker for offline access.

## > tech_stack

| Layer | Technology |
|-------|-----------|
| Language | Vanilla TypeScript (no framework) |
| UI | Web Components (`<ar-dropzone>`, `<ar-viewer>`, `<ar-progress>`) |
| Build | Vite 6 |
| Testing | Vitest |
| ML Runtime | Transformers.js (ONNX Runtime Web) |
| ML Models | RMBG-1.4 INT8 (~45MB) |
| GPU | WASM (WebGPU reserved for future) |
| Processing | Canvas API + OffscreenCanvas in Web Workers |
| Caching | Service Worker + Cache API |
| Styling | Custom CSS (JetBrains Mono, zero dependencies) |
| i18n | Lightweight custom system (EN/ES/FR/DE/PT/ZH) |

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
| ML background removal (RMBG-1.4) | Yes | Yes (proprietary) | Yes | Yes |
| Auto content-type detection | Yes | No | No | No |
| Checkerboard detection | Yes | No | No | Manual |
| Watermark removal (Gemini + DALL-E) | Yes | No | No | Manual |
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

If NukeBG saves you time, consider keeping the reactor running:

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=github-sponsors&logoColor=white&style=for-the-badge)](https://github.com/sponsors/yocreoquesi)

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/yocreoquesi)

---

**Built for creators who are done dealing with garbage backgrounds. Open source forever.**
