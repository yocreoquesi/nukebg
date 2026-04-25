# scripts/

One-off CLI helpers — not part of the runtime. Each script is
standalone (`node scripts/<name>.mjs` or `tsx scripts/<name>.ts`) and
documents its own usage at the top of the file.

## Build / CI helpers

| Script | Purpose |
| --- | --- |
| `compute-csp-hashes.mjs` | Recompute the `'sha256-…'` directives for every inline `<script>` block in `index.html`. Run after editing JSON-LD or any other inline script, then paste the printed line into `nginx.conf` + `public/_headers`. The companion test (`tests/csp-hashes.test.ts`) fails CI if the hashes drift. |

## Pipeline diagnostics (one-off)

These helpers exist to debug the alpha pipeline against fixed input
images. They write JSON / PNG dumps to `dist/` or stdout and are not
called by the runtime:

| Script | Purpose |
| --- | --- |
| `analyze-holes.mjs` | Detect interior holes (transparent islands) in an alpha mask and report counts + sizes. Used to tune cluster-size thresholds. |
| `analyze-lowalpha.mjs` | Histogram the alpha channel and surface low-confidence bands (α ∈ [10..240]). Used when the RMBG threshold needs adjusting per image type. |
| `analyze-region.mjs` | Crop a rectangular region and report per-pixel RGB + alpha statistics. |
| `analyze-speckle.mjs` | Count tiny disconnected alpha blobs (speckle), grouped by size. Drives the `MIN_CLUSTER_SIZE` constants. |
| `remove-bg-rmbg.ts` | Run the RMBG-1.4 segmenter against a single image, save the mask + composited PNG. Used to compare model upgrades. |
| `validate.ts` | Run a full pipeline pass over every fixture in `tests/fixtures/` and emit a per-image report (timing, content-type, watermark hits). |
| `validate-mascots.ts` | Same as `validate.ts` but scoped to the cartoon-mascot fixtures used to tune the illustration branch. |
| `test-ml.ts` | Smoke-test the ML worker contract end-to-end against a single fixture. |
