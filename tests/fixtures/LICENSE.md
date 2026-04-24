# Fixture image licences

Each PNG / JPEG / WebP under `tests/fixtures/` is used by the test
suite (Vitest + Playwright). They never ship with production builds.

| File | Source | Licence | Notes |
| --- | --- | --- | --- |
| `coche.jpg` | Pexels (royalty-free stock) | Pexels Licence | Generic car shot — used by `e2e/coche-capture.spec.ts` to baseline an outdoor photo. |
| `fiat-clean.png` | Manually authored | Project licence (GPL-3.0) | Vector mock car on a clean checkerboard. Drives illustration-branch fixtures. |
| `football.webp` | Pexels | Pexels Licence | Stadium photo with green-on-green subject — adversarial RMBG case. |
| `motorcycles-clean.png` | Manually authored | Project licence (GPL-3.0) | Vector mock — drives `tests/components` snapshots. |
| `motostest.jpeg` | Pexels | Pexels Licence | Motorbike photo with hard edges + halo — used to tune foreground decontamination. |
| `selfie-clean-corner.png` | Manually authored | Project licence (GPL-3.0) | Synthetic checkerboard fixture for AI-generated images. |
| `selfie-sparkle-full.png` | Manually authored | Project licence (GPL-3.0) | Synthetic Gemini-watermark fixture. |
| `trump-clean.png` | Manually authored | Project licence (GPL-3.0) | High-contrast portrait fixture for the illustration branch. |

If you add a fixture:

1. Pick royalty-free stock (Pexels, Unsplash, Pixabay) or author it yourself.
2. Append a row above with source + licence.
3. Don't commit anything that needs commercial-use clearance — the
   tests fan out to public CI and visual-regression baselines that
   can't be retracted later.
