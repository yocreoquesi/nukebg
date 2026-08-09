/**
 * Device adaptation: a single seam where the detected `CapabilityTier`
 * decides processing parameters callers used to hardcode.
 *
 * Background: the capability detector picks a tier (`low` | `mid` |
 * `high` | `ultra`) and we already use it to compute a downscale
 * target (`computeTargetSize`). The tier was NOT feeding back into
 * `PrecisionMode` selection — both ar-app and batch-orchestrator
 * called `pipeline.process(..., 'high-power', ...)` regardless of
 * device. On a low-RAM mobile that meant running desktop-tuned spatial
 * passes (2 passes, radius 5) on top of the downsample. Two knobs to
 * adapt the same problem; only one was being turned.
 *
 * This module owns the mapping. Callers ask
 * `getRecommendedPrecision()` and forget the rest.
 */

import { getCapability, type CapabilityTier } from './capability-detector';
import type { PrecisionMode } from '../pipeline/constants';

/**
 * Map a capability tier to the precision mode that strikes the right
 * memory / quality balance.
 *
 * `low` falls back to `normal`: 1 spatial pass instead of 2 (the dominant
 * cost on a downsampled-then-segmented frame), same `rmbgThreshold`
 * direction as `high-power` (still strict — keeps halos cut). This gives
 * back a meaningful chunk of CPU and intermediate buffer memory on
 * mobile without changing how aggressively the model crops the subject.
 *
 * `mid`, `high`, `ultra` keep `high-power` — that's the empirically
 * tuned default the user-facing pipeline already shipped on. `full-nuke`
 * is intentionally NOT auto-selected even on `ultra`: it's a different
 * quality point (more aggressive removal, 3 passes), surfaced to the
 * user as an opt-in when one exists, not a silent upgrade.
 */
export function getPrecisionForTier(tier: CapabilityTier): PrecisionMode {
  if (tier === 'low') return 'normal';
  return 'high-power';
}

/**
 * Sugar for callers that just want "what should we run here, given the
 * detected device". Reads the cached capability — no probing on the hot
 * path. Use this in `pipeline.process(...)` instead of hardcoding a
 * precision string.
 */
export function getRecommendedPrecision(): PrecisionMode {
  return getPrecisionForTier(getCapability().tier);
}
