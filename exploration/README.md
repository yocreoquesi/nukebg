# Model Lab — background-removal exploration

Staging-only workspace to compare foreground-segmentation models and refinement
strategies before picking a production winner for NukeBG.

> **This directory's heavy artifacts are gitignored.** Only source code
> (loaders, bench, UI hooks) is tracked. Models, sample images, and result
> grids stay local.

## Goal

Address two pain points from user feedback on v2.6.0:

1. **Holes in clothing / shoes** when they share colors with the background.
2. **More imperfections as image size grows**, even after downscale.

We compare three models × two pipeline modes to find the best tradeoff between
quality, weight, and in-browser latency.

## Candidates

| Model | Params | ONNX weight | License | Notes |
|---|---|---|---|---|
| **RMBG-1.4 INT8** | 44M | ~45 MB | Apache 2.0 | Current production baseline |
| **RMBG-2.0** | 215M | ~176 MB FP16 | CC BY-NC 4.0 | Non-commercial — staging comparison only |
| **BiRefNet-general** | 220M | ~220 MB FP16 | MIT | Full version (not lite). First-choice challenger |

All three run via **ONNX Runtime Web with WebGPU** (WASM fallback). Models are
loaded from the HuggingFace CDN at runtime — we never ship them in the bundle.

## Modes

| Mode | Description |
|---|---|
| `single-pass` | Current behavior: one inference at model-native size (1024) |
| `bbox-refine` | Two-pass: coarse mask → crop original to subject bbox → second inference on crop → place fine alpha back. Outside-bbox pixels guaranteed background |

A deferred third mode — **tiled inference with global prior** — is parked until
we have evidence it's needed on top of bbox-refine.

## Visibility

The model/mode selector appears **only** when `location.hostname` is
`localhost` or a `*.pages.dev` staging domain. Production (`nukebg.app`)
stays locked to the default model with no UI change.

## Directory layout

```
exploration/
├── README.md              # this file
├── models/                # .onnx downloads (gitignored)
├── samples/               # test images (gitignored)
│   └── feedback/          # images from the v2.6.0 feedback report
├── results/               # comparison grids (gitignored)
├── loaders/               # ONNX wrappers (tracked)
│   ├── rmbg14.ts          # wraps existing Transformers.js path
│   ├── rmbg20.ts          # new — ONNX Runtime Web + WebGPU
│   └── birefnet.ts        # new — ONNX Runtime Web + WebGPU
└── bench/                 # local benchmark runner (tracked)
    └── compare.ts
```

## Adding local samples

```bash
# Clone reference repos for their sample sets
git clone https://github.com/Efrat-Taig/RMBG-2.0 /tmp/rmbg20-samples
git clone https://github.com/ZhengPeng7/BiRefNet /tmp/birefnet-samples

# Copy whatever looks useful into exploration/samples/ — they stay local
cp /tmp/rmbg20-samples/examples/*.jpg exploration/samples/
cp /tmp/birefnet-samples/examples/*.jpg exploration/samples/
```

## Decision criteria

A challenger replaces RMBG-1.4 in production when it beats the baseline on:

1. **Clothing / shoe hole rate** on the feedback sample set (visual A/B).
2. **Latency on mid-tier hardware** (target: <5s on Apple M1 / mid-range laptop).
3. **First-load weight** (budget: ≤250 MB total model weight shipped from CDN).
4. **License compatibility** with whatever future monetization NukeBG adopts.

If no browser-viable model clears the bar, fallback is a **Tauri desktop app**
reusing this same TypeScript core against native ONNX Runtime.

## Out of scope (for this lab)

- Shipping any challenger to production
- Bundling model weights into the repo
- Automated CI benchmarks (decided manually by eyeballing the grid)
