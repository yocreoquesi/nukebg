# CONTRIBUTING

> You want to help nuke backgrounds? Good. Here's how to not waste your time or ours.

---

## > ground_rules

```
$ cat /dev/rules

1. Be respectful. We're building tools, not drama.
2. No server-side processing. Ever. This is 100% client-side. Non-negotiable.
3. No tracking, analytics, or cookies. Privacy is the whole point.
4. No external dependencies without opening an issue first.
5. Don't break offline mode. The Service Worker must keep working.
```

---

## > setup

### Requirements

- **Node.js** 18+
- **npm** (comes with Node)
- Chrome 113+ recommended (WebGPU support)

### Clone and run

```bash
# 1. Fork the repo on GitHub

# 2. Clone your fork
$ git clone https://github.com/YOUR_USER/nukebg.git
$ cd nukebg

# 3. Install
$ npm install

# 4. Dev server
$ npm run dev
# http://localhost:5173

# 5. Verify build
$ npm run build
```

### Available scripts

| Command              | What it does                               |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | Vite dev server with HMR                   |
| `npm run build`      | TypeScript compile + Vite production build |
| `npm run preview`    | Preview the production build locally       |
| `npm test`           | Run tests once (Vitest)                    |
| `npm run test:watch` | Run tests in watch mode                    |

---

## > project_structure

```
nukebg/
├── src/
│   ├── main.ts                        # Entry point, registers Web Components
│   ├── sw-register.ts                 # Service Worker registration
│   ├── components/                    # Web Components (Shadow DOM)
│   │   ├── ar-app.ts                  # Root app component
│   │   ├── ar-dropzone.ts             # Drag-and-drop image upload
│   │   ├── ar-viewer.ts              # Before/after viewer with slider
│   │   ├── ar-editor.ts              # Image editor controls
│   │   ├── ar-progress.ts            # Pipeline progress indicator
│   │   ├── ar-download.ts            # Download result button
│   │   └── ar-privacy.ts             # Privacy notice
│   ├── pipeline/
│   │   ├── orchestrator.ts            # Coordinates CV and ML workers
│   │   └── constants.ts              # Algorithm thresholds and params
│   ├── workers/
│   │   ├── cv.worker.ts               # Classical vision Web Worker
│   │   ├── ml.worker.ts              # ML inference Web Worker (Transformers.js)
│   │   └── cv/                        # Individual CV algorithm modules
│   │       ├── detect-bg-colors.ts    # Corner-sampling background detection
│   │       ├── detect-checker-grid.ts # Checkerboard pattern detection
│   │       ├── grid-flood-fill.ts     # Grid-aware flood fill
│   │       ├── subject-exclusion.ts   # Subject exclusion by cell analysis
│   │       ├── simple-flood-fill.ts   # Edge-based flood fill
│   │       ├── watermark-detect.ts    # Gemini sparkle watermark detection
│   │       ├── watermark-dalle.ts     # DALL-E watermark detection
│   │       ├── inpaint-telea.ts       # Telea FMM inpainting
│   │       ├── shadow-cleanup.ts      # Shadow/artifact cleanup
│   │       ├── alpha-refine.ts        # Alpha channel refinement
│   │       └── utils.ts              # Shared CV utilities
│   ├── types/                         # Shared TypeScript types
│   ├── utils/                         # Image I/O, canvas helpers
│   └── styles/                        # CSS (JetBrains Mono, zero deps)
├── tests/                             # Vitest + happy-dom
├── docs/                              # Internal docs
├── public/                            # Static assets (favicon, manifest, og-image)
└── dist/                              # Production build output
```

### Key concepts

- **Pipeline Orchestrator** lives on the main thread. Dispatches work to Web Workers.
- **CV Worker** runs classical algorithms: checkerboard detection, flood fill, watermark removal, shadow cleanup, alpha refinement.
- **ML Worker** runs inference via Transformers.js (RMBG-1.4). Lazy-loaded on demand.
- **Web Components** use Shadow DOM + Custom Events on `document` for inter-component communication.
- Worker communication uses `postMessage` with `Transferable` objects (`ImageData`) for zero-copy transfers.

---

## > tests

```bash
# Run all tests once
$ npm test

# Watch mode (re-runs on save)
$ npm run test:watch
```

Tests use **Vitest** with **happy-dom** as the simulated browser environment.

### Writing tests

- Tests go in `tests/`.
- CV algorithm modules should have unit tests with synthetic or reference image data.
- Component tests verify Custom Elements register correctly and emit the right events.
- More coverage is always welcome, especially edge-case tests for CV algorithms.

---

## > pull_requests

### Before you start

1. **Open an issue first** if your change is significant (new feature, big refactor). Discuss the approach before you invest time.
2. **Create a branch** from `main` with a descriptive name: `feat/batch-processing`, `fix/checker-grid-edge-case`, etc.

### Process

```bash
# 1. Make your changes on your branch

# 2. Build must pass
$ npm run build

# 3. Tests must pass
$ npm test

# 4. Test manually in Chrome and Firefox

# 5. Commit following the conventions below

# 6. Open a PR against main
```

### PR rules

```
[!] ONE PR = ONE PURPOSE. Keep it focused.
[!] DESCRIBE WHAT AND WHY in the PR description. Link the related issue.
[!] DON'T BREAK OFFLINE MODE. Verify the Service Worker still works.
[!] NO SERVER-SIDE PROCESSING. NukeBG is 100% client-side. Period.
[!] NO TRACKING OR ANALYTICS. Privacy is a core value.
[!] NO NEW DEPENDENCIES without prior discussion in an issue.
```

### PR checklist

```
- [ ] Code compiles clean (npm run build)
- [ ] Tests pass (npm test)
- [ ] Works in Chrome (WebGPU) and Firefox (WASM fallback)
- [ ] No hardcoded magic numbers (use constants.ts)
- [ ] Commits follow the convention
```

### CI gates (must be green to merge)

The `Typecheck + tests` job in `.github/workflows/ci.yml` runs:

1. `npm run typecheck` (`tsc --noEmit`)
2. `npm test` (vitest, ~600 source-invariant tests)
3. `npm run build` — same command Cloudflare Pages runs on every deploy

If `Typecheck + tests` is red, the deploy is red too — fix before merging. The Lint + format job is non-blocking today (`continue-on-error: true`) while the codebase finishes migrating to the strict ESLint + Prettier config; flip that flag once the formatter is fully run.

### Branch protection (recommended on `main`)

The repo doesn't ship branch-protection rules in code, but the
maintainers should configure them in GitHub Settings → Branches once
the codebase is stable enough:

- Require **Typecheck + tests** to pass before merging.
- Require **Cloudflare Pages** preview to succeed (deploy proves the
  build works under the production toolchain).
- Require **CodeQL** to pass (catches new security smells on PRs).
- Require linear history + signed commits if your team prefers.
- Disallow force-pushes to `main`.

The `Playwright pipeline e2e` job is currently fragile (multi-input
strict-mode failure from the camera CTA + visual baseline drift) and
should NOT be a required check until those flakes are resolved — see
issues #76 and #77 for the underlying UX work.

---

## > commits

Format: `type: short description`

### Types

| Type       | When to use                      |
| ---------- | -------------------------------- |
| `feat`     | New functionality                |
| `fix`      | Bug fix                          |
| `docs`     | Documentation changes            |
| `test`     | Adding or fixing tests           |
| `refactor` | Refactor without behavior change |
| `infra`    | Build, CI/CD, deployment         |
| `security` | Security-related changes         |
| `design`   | UI/UX changes                    |

### Examples

```
feat: add DALL-E watermark detection
fix: correct flood-fill at image borders
docs: update README with new screenshots
test: add tests for 64px grid checkerboard
refactor: extract BFS logic to shared module
infra: add CI workflow with GitHub Actions
```

---

## > code_style

### TypeScript

- Strict mode (`strict: true` in tsconfig). No `any`.
- Shared type definitions live in `src/types/`.
- CV algorithms must be pure functions: data in, result out, no side effects.
- No `eval`, no inline scripts. Strict CSP enforced.

### Components

- Native Web Components with Shadow DOM. No framework. No JSX.
- Inter-component communication via Custom Events on `document`.

### Accessibility

- WCAG 2.1 AA compliance required.
- Keyboard navigation on all interactive controls.
- Screen reader announcements on state changes.
- Respect `prefers-reduced-motion`.

### Parameters

- All magic numbers and algorithm thresholds go in `src/pipeline/constants.ts`.
- Never hardcode values directly in algorithm modules.

---

## > contribution_areas

### CV algorithms

Modules live in `src/workers/cv/`. Each is a pure function operating on `ImageData` or `Uint8Array`. If you improve an algorithm, test it with real images from multiple generators (Gemini, DALL-E, Midjourney, Stable Diffusion, Flux).

### ML pipeline

The ML worker lives in `src/workers/ml.worker.ts`. Uses Transformers.js with RMBG-1.4 INT8. WASM runtime. Model loads on demand. Auto-classification routes images through the optimal pipeline path.

### UI components

Components are in `src/components/`. Native Web Components with Shadow DOM. Accessibility is mandatory: keyboard nav, screen readers, `prefers-reduced-motion` support.

### Tests

More test coverage is always welcome. Especially CV algorithm tests with edge-case images.

---

## > operational_docs

Runbooks for one-off maintainer tasks. Not user-facing.

- [`docs/donors.md`](docs/donors.md) — donor consent workflow, email
  template, JSON edits, GDPR removal procedure for the supporters
  shown on `/reactor`.

---

## > licensing_of_contributions

NukeBG is published under [GPL-3.0-only](LICENSE). To keep the door open for
future relicensing decisions (dual-licensing, swapping to a more permissive OSI
license, or repackaging parts of the codebase under a different model), every
contribution accepted into this repo is governed by the following terms.

By submitting a pull request to this repository, you (the contributor) certify
that:

1. **Origin** — The contribution was created in whole by you, or you have the
   right to submit it under the licensing terms below. If your contribution
   includes third-party code, you have made that clear in the PR description
   along with the third-party license.
2. **Project license grant** — Your contribution is licensed under
   [GPL-3.0-only](LICENSE) for inclusion in the project.
3. **Relicense grant** — You additionally grant the project owner
   ([@yocreoquesi](https://github.com/yocreoquesi)) a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable right to relicense your
   contribution under any [OSI-approved license](https://opensource.org/licenses)
   in the future, at the project owner's discretion. This keeps the project's
   relicensing options open without requiring contributor sign-off for every
   change.
4. **Patent grant** — You grant the same perpetual patent license to anyone
   using the project as the GPL-3.0 already provides for the GPL portion.

You are not assigning copyright — you keep ownership of your work. You are
granting the project the rights it needs to ship and evolve.

This sits in lieu of a separate signed CLA. By opening a PR you acknowledge
these terms; the maintainer will check this is understood on first-time
contributions before merging.

If any of the above is a problem for your contribution (e.g. corporate IP that
can't be licensed this way), open an issue first to discuss before submitting
the PR. We can usually find a path.

---

```
$ echo "Thanks for helping nuke garbage backgrounds."
Thanks for helping nuke garbage backgrounds.
```
