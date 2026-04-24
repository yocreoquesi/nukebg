# Changelog

All notable changes to NukeBG land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and dates are ISO 8601.
Versioning follows [SemVer](https://semver.org/): MAJOR for breaking UX / pipeline
contract changes, MINOR for new user-visible features, PATCH for fixes and polish.

Unreleased entries accumulate on the `dev` branch. When we cut a release we copy
`[Unreleased]` into a dated section and open a fresh `[Unreleased]` shell.

## [Unreleased]

### Added
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
- **End-to-end `AbortController`** plumbed from UI → orchestrator → every
  worker. ([#58](https://github.com/yocreoquesi/nukebg/pull/58))
- **20-minute wall-clock timeout** on `process()` to break runaway runs.
  ([#61](https://github.com/yocreoquesi/nukebg/pull/61))
- **Frozen `PipelineResult` + LaMa download size validation**
  ([#56](https://github.com/yocreoquesi/nukebg/pull/56)).

### Accessibility
- **Reduced-motion audit** across every component that ships `@keyframes`;
  viewer slider reveal respects both OS reduced-motion and the in-app quiet
  mode. ([#100](https://github.com/yocreoquesi/nukebg/pull/100))
- **Escape closes the shortcuts popover** ([#62](https://github.com/yocreoquesi/nukebg/pull/62)).

### Infrastructure
- **Runtime hardening** — tokens, size limits, caps, engine pins, HEALTHCHECK.
  ([#66](https://github.com/yocreoquesi/nukebg/pull/66))
- **Production sourcemaps disabled**
  ([#51](https://github.com/yocreoquesi/nukebg/pull/51)).

### Tooling / CI
- **ESLint + Prettier + CI lint job + WebKit e2e** in Playwright matrix.
  ([#67](https://github.com/yocreoquesi/nukebg/pull/67))
- **Safari cross-engine validation** — WebKit matrix + iPhone profile +
  BrowserStack manual workflow.
  ([#88](https://github.com/yocreoquesi/nukebg/pull/88))
- **`npm run typecheck`** script ([#55](https://github.com/yocreoquesi/nukebg/pull/55)).
- **i18n key-parity guard** in the test suite
  ([#64](https://github.com/yocreoquesi/nukebg/pull/64)).

### Documentation
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
