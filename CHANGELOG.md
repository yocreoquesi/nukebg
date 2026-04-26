# Changelog

All notable changes to NukeBG land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and dates are ISO 8601.
Versioning follows [SemVer](https://semver.org/): MAJOR for breaking UX / pipeline
contract changes, MINOR for new user-visible features, PATCH for fixes and polish.

Unreleased entries accumulate on the `dev` branch. When we cut a release we copy
`[Unreleased]` into a dated section and open a fresh `[Unreleased]` shell.

## [Unreleased]

## [2.8.0] — 2026-04-25

### Added

- **Theme picker grew to six palettes** — original four (terminal-green / amber
  / cyan / magenta) plus **red** (`#ff3344`) and **yellow** (`#ffee00`). Each
  swatch now glows its own colour on hover/focus while the active-state ring
  stays on the global accent token for consistency with the rest of the app.
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Reprocess button in the advanced editor** — re-runs RMBG-1.4 on whatever
  the canvas currently shows. Erased regions are composited onto pure white
  before being fed to the model so they're treated as background, letting the
  user delete unwanted objects manually and re-segment the rest. Result is
  piped through the same `refineEdges` cleanup the main pipeline uses
  (sharpen + topology cleanup) so weak shadow detections don't survive.
  ([#120](https://github.com/yocreoquesi/nukebg/pull/120))
- **Theme switcher in the footer** — four palettes (terminal-green / amber /
  cyan / magenta) via `:root[data-theme="X"]` overrides. WAI-ARIA radiogroup
  with keyboard nav; persisted in `localStorage["nukebg:theme"]`.
  ([#115](https://github.com/yocreoquesi/nukebg/pull/115))
- **In-dropzone model progress** — first-run progress relocated INTO the
  dropzone in the same vertical row as the camera CTA, so the page never
  reflows when the model finishes warming up. ar-app drives it via a new
  `dropzone.setLoadingState(...)` API. ([#114](https://github.com/yocreoquesi/nukebg/pull/114))
- **Reactor offline → active** in the [STATUS] line — only flips green after
  preload resolves. Dot + word dim while idle.
  ([#114](https://github.com/yocreoquesi/nukebg/pull/114))
- **Recovered honesty + Ko-fi pitch** in the hero — `features.disclaimer` and
  a new `support.kofi` i18n key (six locales).
  ([#114](https://github.com/yocreoquesi/nukebg/pull/114))
- **Global keyboard shortcuts + `?` hint overlay** — press `/` to focus the
  dropzone, `?` to see the full cheat-sheet, Esc to dismiss. Works across every
  shadow tree via a light-DOM overlay. ([#101](https://github.com/yocreoquesi/nukebg/pull/101))
- **PWA app shortcuts + deep-link handler** — installed app exposes "New image"
  and "Keyboard shortcuts" on long-press; `launch_handler.client_mode:
focus-existing` reuses the open tab; `?help=1` / `?action=new` query params
  re-dispatch the matching keyboard shortcut.
  ([#102](https://github.com/yocreoquesi/nukebg/pull/102))
- **Quiet mode toggle** — `data-playful` attribute gates CRT flicker, smoke,
  vibration, and the playful palette. OS `prefers-reduced-motion` flips it to
  quiet by default. ([#89](https://github.com/yocreoquesi/nukebg/pull/89))
- **Web Share button** — share the processed PNG straight from the result
  screen on devices that support the Web Share API.
  ([#91](https://github.com/yocreoquesi/nukebg/pull/91))
- **Mobile hero + camera CTA** — compact mobile hero, `capture="environment"`
  so Android opens the back camera directly.
  ([#86](https://github.com/yocreoquesi/nukebg/pull/86))
- **Reactor Power segmented control** — quality/speed slider replacing the
  binary toggle. ([#82](https://github.com/yocreoquesi/nukebg/pull/82))
- **Landing redesign** — marquee bleed, ASCII dropzone, status line.
  ([#83](https://github.com/yocreoquesi/nukebg/pull/83))
- **Processing command bar + viewer chips** — command-line framing around the
  live pipeline; Cancel moved into the command bar.
  ([#84](https://github.com/yocreoquesi/nukebg/pull/84))
- **Download CTA** — two-line terminal commands with live filename + byte
  metadata. ([#85](https://github.com/yocreoquesi/nukebg/pull/85))
- **Result two-column grid on desktop** — viewer + downloads side-by-side at
  ≥ 900 px. ([#90](https://github.com/yocreoquesi/nukebg/pull/90))
- **Advanced editor preview diff counts** — shows pixels added / removed per
  refine pass. ([#93](https://github.com/yocreoquesi/nukebg/pull/93))
- **Advanced editor two-row toolbar** — split tool buttons from modifiers so
  the bar fits in narrow viewports. ([#96](https://github.com/yocreoquesi/nukebg/pull/96))
- **Basic editor shortcuts sidebar + mini command bar + left rail** at ≥ 900 px
  ([#94](https://github.com/yocreoquesi/nukebg/pull/94),
  [#95](https://github.com/yocreoquesi/nukebg/pull/95),
  [#99](https://github.com/yocreoquesi/nukebg/pull/99)).
- **First-run model download explainer** — explains why the first nuke streams
  ~80 MB of ONNX, plus a progress-aware modal.
  ([#97](https://github.com/yocreoquesi/nukebg/pull/97))
- **Below-fold SEO block** — "how it works" + "vs alternatives" long-form
  copy for search discoverability.
  ([#92](https://github.com/yocreoquesi/nukebg/pull/92))
- **Inline error-stage actions** — retry / report / reload without losing the
  page. ([#98](https://github.com/yocreoquesi/nukebg/pull/98))
- **Pipeline error modal with Retry** ([#65](https://github.com/yocreoquesi/nukebg/pull/65)).
- **Cancel button in `ar-progress`** ([#63](https://github.com/yocreoquesi/nukebg/pull/63)).

### Changed

- **Manual editor edits survive Apply** — both basic and advanced editors now
  pass `skipTopologyCleanup: true` to `refineEdges`. Previously the
  `keepLargestComponent` pass discarded any user edit (lasso crop, restore)
  that wasn't connected to the largest blob — visible as "the lasso reverted
  to the pipeline's silhouette" on Apply.
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Command bar updates across batch navigation** — when navigating processed
  items in a batch, the cmd bar (`$ nukea filename ● state`) now syncs to
  each item's filename + state instead of staying frozen on the first one.
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Cmd bar "ready" state renamed to nukeada / nuked** across en/es/fr/pt
  to peg with the `$ nukea` verb that prefixes every command. de stays
  `fertig`, zh stays as-is.
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Download buttons simplified** — each CTA now shows just `# {file size}`.
  Resolution moved out (already shown above the image) and the `alpha` /
  `alfa` indicator dropped. Clearer side-by-side comparison of PNG vs WebP.
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Advanced editor brush/eraser cursor** is now 2 px wide (was 1 px hairline)
  and follows the active theme — eraser is no longer hardcoded red. The two
  tools are differentiated by stroke pattern (brush solid, eraser dashed)
  instead of colour, so every theme stays coherent.
  ([#120](https://github.com/yocreoquesi/nukebg/pull/120))
- **Lasso anchor handles removed** — the dots on each simplified vertex were
  visual noise. Polygon outline stays at the same 2 px stroke for consistency
  with the cursor circle.
  ([#120](https://github.com/yocreoquesi/nukebg/pull/120))
- **Brush size slider lives in the primary toolbar row** — moved out of the
  contextual row so switching to lasso no longer collapses the row and shifts
  the canvas up. Slider stays mounted always, fades to 40 % opacity +
  pointer-events disabled when lasso is active.
  ([#120](https://github.com/yocreoquesi/nukebg/pull/120))
- **Restore-original drops its confirm bar** — `pushUndo()` already snapshots
  before restore, so Ctrl+Z reverts cleanly. Confirmation was friction
  without value. Dead `showConfirm` infrastructure (CSS, markup, i18n keys)
  removed. ([#120](https://github.com/yocreoquesi/nukebg/pull/120))
- **Pipeline pinned to `'high-power'`** — the segmentation pipeline now always
  runs at the better-bordered profile (extra spatial pass, finer cluster
  threshold). Previously gated behind the Reactor segmented control.
  ([#113](https://github.com/yocreoquesi/nukebg/pull/113))
- **Reactor segmented control + Alt+1..4 shortcut removed** — every visible
  trace of the four-mode picker is gone (CSS, click handlers, marquee swap,
  CRT flicker, smoke, vibrate, ~700 LOC of UI). Replaced by the theme switcher
  for cosmetic palette changes.
  ([#113](https://github.com/yocreoquesi/nukebg/pull/113))
- **MAX_PIXELS lowered from 100 MP → 32 MP** — covers every current iPhone /
  Pixel sensor while keeping inpaint + LaMa peak RAM safe on low-end phones.
  ([#111](https://github.com/yocreoquesi/nukebg/pull/111))
- **"How it works" + "vs other tools" SEO block removed** from below-fold —
  JSON-LD HowTo + FAQ already cover the same ground for SERPs.
  ([#112](https://github.com/yocreoquesi/nukebg/pull/112))
- **"Try a sample" demo CTA reverted** — the synthetic image was triggering
  a false-positive watermark detection.
  ([#111](https://github.com/yocreoquesi/nukebg/pull/111))
- **Polish pass** — typography tokens collapsed to 12/14/16, progress bar
  height tightened, tablet header gets the portable-mode tagline.
  ([#87](https://github.com/yocreoquesi/nukebg/pull/87))
- **Mobile batch grid → 2 columns** to keep thumbs a tap-target size.
  ([#91](https://github.com/yocreoquesi/nukebg/pull/91))
- **`touch-action` applied unconditionally** — editor pinch/zoom now works
  regardless of user prefs. ([#62](https://github.com/yocreoquesi/nukebg/pull/62))
- **Tertiary text color** raised to WCAG AA contrast.
  ([#64](https://github.com/yocreoquesi/nukebg/pull/64))

### Security

- **CSP: `script-src 'unsafe-inline'` removed** — strict inline-hash allowlist
  only. ([#57](https://github.com/yocreoquesi/nukebg/pull/57))
- **DNS prefetch disabled + HF preconnects dropped** to preserve the
  zero-outbound-by-default promise on the marketing path.
  ([#52](https://github.com/yocreoquesi/nukebg/pull/52))
- **Image magic-byte validation** before decode — rejects renamed/corrupt
  uploads at the edge. ([#53](https://github.com/yocreoquesi/nukebg/pull/53))
- **LaMa model pinned** by revision, size, and SHA-256 — supply-chain
  hardening against silent inpaint-model swaps.
  ([#60](https://github.com/yocreoquesi/nukebg/pull/60))

### Pipeline

- **`pendingTimers` leak plugged** — every worker response now routes through
  a `settlePending()` helper that clears the watchdog timer and drops it from
  the set in one step (closes #44).
  ([#106](https://github.com/yocreoquesi/nukebg/pull/106))
- **End-to-end `AbortController`** plumbed from UI → orchestrator → every
  worker. ([#58](https://github.com/yocreoquesi/nukebg/pull/58))
- **20-minute wall-clock timeout** on `process()` to break runaway runs.
  ([#61](https://github.com/yocreoquesi/nukebg/pull/61))
- **Frozen `PipelineResult` + LaMa download size validation**
  ([#56](https://github.com/yocreoquesi/nukebg/pull/56)).

### Accessibility

- **Editor canvases are tabbable + described** — `tabindex="0"`, `role="img"`,
  `aria-label` wired through new `editor.canvasLabel` /
  `advanced.canvasLabel` i18n keys.
  ([#107](https://github.com/yocreoquesi/nukebg/pull/107))
- **Viewer slider WAI-ARIA steps** — Shift+Arrow / PageUp / PageDown move ±10,
  Home/End jump to 0/100, ArrowUp/Down work as vertical synonyms.
  ([#107](https://github.com/yocreoquesi/nukebg/pull/107))
- **Alt+1..4 reactor shortcuts** removed alongside the Reactor pivot.
  ([#113](https://github.com/yocreoquesi/nukebg/pull/113))
- **Reduced-motion audit** across every component that ships `@keyframes`;
  viewer slider reveal respects both OS reduced-motion and the in-app quiet
  mode. ([#100](https://github.com/yocreoquesi/nukebg/pull/100))
- **Escape closes the shortcuts popover** ([#62](https://github.com/yocreoquesi/nukebg/pull/62)).

### Infrastructure

- **Runtime hardening** — tokens, size limits, caps, engine pins, HEALTHCHECK.
  ([#66](https://github.com/yocreoquesi/nukebg/pull/66))
- **Production sourcemaps disabled**
  ([#51](https://github.com/yocreoquesi/nukebg/pull/51)).

### Internationalization

- **RTL scaffolding** — `getDirection(locale)` helper + auto-flip of
  `<html dir>` so a future RTL translation lands without code changes.
  Handles BCP-47 region tags. (closes #38)
  ([#109](https://github.com/yocreoquesi/nukebg/pull/109))

### Tooling / CI

- **`exploration/` promoted to `src/refine/`** — what was lab-tagged code has
  been imported by the production advanced editor since v2.4. Folder renamed,
  ESLint + Prettier carve-out removed, files reformatted to repo style. Test
  folder renamed from `tests/exploration/` → `tests/refine/`. No runtime
  behaviour change. ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **Playwright e2e selectors fixed** — `ar-dropzone` exposes two file inputs
  (regular + mobile camera CTA) since #86; specs now disambiguate with
  `:not(.dz-camera-input)`. `#download-btn` references replaced with
  `#dl-png`. Visual-landing baselines seeded for chromium / webkit / iphone
  on Linux so regressions actually fire instead of "snapshot doesn't exist".
  ([#119](https://github.com/yocreoquesi/nukebg/pull/119))
- **CI runs `npm run build`** on every PR so deploy-time regressions fail
  before merge. Output sanity check confirms `dist/index.html`, JSON-LD
  blocks, and `dist/assets`. ([#110](https://github.com/yocreoquesi/nukebg/pull/110))
- **CSP hash + image-io tests EOL-agnostic** so CRLF checkouts on Windows
  no longer drift the hashes against LF on Linux CI.
  ([#110](https://github.com/yocreoquesi/nukebg/pull/110))
- **ESLint + Prettier + CI lint job + WebKit e2e** in Playwright matrix.
  ([#67](https://github.com/yocreoquesi/nukebg/pull/67))
- **Safari cross-engine validation** — WebKit matrix + iPhone profile +
  BrowserStack manual workflow.
  ([#88](https://github.com/yocreoquesi/nukebg/pull/88))
- **`npm run typecheck`** script ([#55](https://github.com/yocreoquesi/nukebg/pull/55)).
- **i18n key-parity guard** in the test suite
  ([#64](https://github.com/yocreoquesi/nukebg/pull/64)).

### Documentation

- **`scripts/README.md`** documents every analyze / validate / CSP helper.
- **`tests/fixtures/LICENSE.md`** captures source + licence per fixture.
- **CONTRIBUTING.md** now lists the CI gates + recommended branch protection
  rules for `main`.
- **COEP intentionally NOT set** — `nginx.conf` carries the rationale +
  recipe to enable `credentialless` later (closes #41).
  ([#108](https://github.com/yocreoquesi/nukebg/pull/108))
- **Zero-network claim reconciled with reality** — clarifies first-run model
  fetch vs. steady-state runtime.
  ([#59](https://github.com/yocreoquesi/nukebg/pull/59))
- **OFL attribution + License Compliance section** in README
  ([#54](https://github.com/yocreoquesi/nukebg/pull/54)).

---

## Release checklist template

When cutting a release, copy the block below into a new `## [x.y.z] — YYYY-MM-DD`
section, keep only the relevant subsections, and empty `[Unreleased]`:

```md
## [0.0.0] — 1970-01-01

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

### Pipeline

### Accessibility

### Infrastructure

### Tooling / CI

### Documentation
```

[Unreleased]: https://github.com/yocreoquesi/nukebg/compare/main...dev
