# Safari testing strategy

NukeBG targets three tiers of Safari-engine coverage at increasing
fidelity and cost.

## Tier 1 — Playwright WebKit (free, per-PR)

Playwright ships its own WebKit build (same engine Apple uses on macOS
and iOS). On every PR, CI runs the `e2e-safari` matrix with two
projects:

| Project  | Playwright preset | Why                                    |
| -------- | ----------------- | -------------------------------------- |
| `webkit` | `Desktop Safari`  | Catches desktop Safari rendering bugs. |
| `iphone` | `iPhone 15 Pro`   | Touch + viewport + iOS-ish behaviour.  |

The job is `continue-on-error: true` today because:

- ML-touching specs (`pipeline.spec.ts`, `*-capture.spec.ts`) hit the
  iOS Safari warmup hang documented at `playwright.config.ts:9`.
- JetBrains Mono hinting differs between Chromium and WebKit, so visual
  snapshots need a `-webkit` / `-iphone` baseline (Playwright handles
  this automatically when running the project).

When adding a visual snapshot, run once locally to generate baselines:

```bash
npx playwright test --project=webkit --update-snapshots
npx playwright test --project=iphone --update-snapshots
git add e2e/*.spec.ts-snapshots/
```

## Tier 2 — Local WebKit (free, optional)

- **macOS**: Safari Technology Preview against `npm run dev`. Same
  WebKit2 that ships in iOS Safari a few months later. Best trade-off
  for manual smoke testing before a release.
- **Linux**: `playwright install --with-deps webkit` bundles
  `webkit2gtk`. Same layout engine as Layer 1 but you can inspect it
  interactively with `PWDEBUG=1 npx playwright test --project=webkit`.

## Tier 3 — Real iOS Safari via BrowserStack (paid, manual)

For final release verification on real iPhone hardware.

- BrowserStack free tier: **100 min/month**, real iPhone 15 / 14 / 13
  on iOS 16–18. Use `.github/workflows/safari-real-device.yml` (manual
  trigger).
- Alternatives: LambdaTest (60 min/month free), Sauce Labs (trial).

**Setup**:

1. Create a BrowserStack account, grab username + access key.
2. Add as repo secrets: `BROWSERSTACK_USERNAME`,
   `BROWSERSTACK_ACCESS_KEY`.
3. Trigger via `Actions → Safari real-device (manual) → Run workflow`.
4. Watch the session recording on the BrowserStack dashboard.

The workflow exits cleanly (non-failing) if the secrets are missing —
safe to leave in the repo without pay-per-run surprises.

**Do this before each release**, not on every PR. Free tier would
drain in an afternoon otherwise.

## What each tier catches

| Class of bug                                     | Tier 1 | Tier 2 | Tier 3 |
| ------------------------------------------------ | ------ | ------ | ------ |
| CSS / layout rendering                           | ✅     | ✅     | ✅     |
| Font hinting / kerning                           | ≈      | ✅     | ✅     |
| WebKit-specific JS engine quirks                 | ✅     | ✅     | ✅     |
| Touch gesture timing (synthetic vs native)       | ≈      | ≈      | ✅     |
| ITP / Intelligent Tracking Prevention / storage  | ❌     | ≈      | ✅     |
| `navigator.share` behaviour                      | ❌     | ❌     | ✅     |
| `capture="environment"` on `<input type="file">` | ❌     | ❌     | ✅     |
| PWA "Add to Home Screen"                         | ❌     | ❌     | ✅     |
| SharedArrayBuffer + COOP / COEP                  | ≈      | ✅     | ✅     |
| iOS Safari warmup hang at 96 % (real ML)         | ❌     | ≈      | ✅     |

Legend: ✅ reliable · ≈ partial · ❌ not testable.

## Known gaps on dev

- The ML pipeline on real iOS Safari hangs at ~96 % warmup — repros
  inconsistently on BrowserStack; the root cause (Transformers.js + ORT
  WASM threading on iOS) is tracked separately.
- `navigator.share` with `files` support varies across iOS versions —
  mobile share sheet (#74) guards with `canShare({ files })`.

## When to add a visual snapshot

Add one whenever a PR changes the landing, workspace, editor, or
anything that materially affects what the user sees. Use both the
`chromium` and `webkit` projects in the spec so we catch hinting /
kerning drift:

```ts
test('landing matches snapshot', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('landing.png', {
    maxDiffPixelRatio: 0.015,
  });
});
```

Playwright stores baselines per-project automatically, so running the
same spec under `chromium` and `webkit` produces two files in
`e2e/<spec>.spec.ts-snapshots/`.
