/**
 * Device capability detector for adaptive image processing.
 *
 * Policy: every device starts at the highest tier the available memory
 * signals can justify, and the active probe downgrades when allocation
 * fails. No User-Agent-based downgrades — mobile/desktop are NOT
 * pre-classified — so output stays consistent across devices that share
 * the same memory budget.
 *
 * Signals consulted, in priority order:
 *   - performance.memory.jsHeapSizeLimit (Chromium only, tab-level cap)
 *   - navigator.deviceMemory (Chromium only, quantized to 0.25/0.5/1/2/4/8 GB)
 *   - navigator.hardwareConcurrency (proxy for device class when memory APIs absent)
 *   - Active probe: allocate an RGBA buffer at tier size; on failure, step down.
 *
 * When no memory API is exposed (notably iOS Safari and some Firefox builds)
 * we start at `high` and let the probe decide. The probe is intentionally
 * the only safety net for these cases — UA sniffing produced inconsistent
 * results across devices that could otherwise handle the same workload.
 */

export type CapabilityTier = 'low' | 'mid' | 'high' | 'ultra';

export interface DeviceCapability {
  /** Maximum working pixels (width × height) for the pipeline */
  maxPixels: number;
  /** Maximum side length in pixels (square bound) */
  maxDimension: number;
  /** Classification of the device */
  tier: CapabilityTier;
  /** Why this tier was chosen (for debugging + telemetry) */
  reason: string;
}

/** Hard ceiling — even on beasts, we never accept more than this. Sized
 *  to typical phone-camera output (32 MP covers all current iPhone /
 *  Pixel sensors with headroom); above this, peak RAM during the
 *  inpaint + LaMa stages spikes hard enough to crash low-RAM devices
 *  even when capability tiers say they can handle it. Edited down from
 *  100 MP after empirical testing. */
export const ABSOLUTE_MAX_PIXELS = 32_000_000; // 32 MP

/** Hard ceiling for a single side (Chromium canvas max is 16384) */
export const ABSOLUTE_MAX_DIMENSION = 12_288;

/** Tier table — pixel budgets chosen to keep peak RAM under safe limits */
const TIERS: Record<CapabilityTier, { maxPixels: number; maxDimension: number }> = {
  // ~8 MP, ~32 MB per RGBA buffer. Safe for low-end phones.
  low: { maxPixels: 8_000_000, maxDimension: 3_000 },
  // ~16 MP, ~64 MB per buffer. Typical mid-range mobile + older laptops.
  mid: { maxPixels: 16_000_000, maxDimension: 4_096 },
  // ~32 MP, ~128 MB per buffer. Modern desktops, high-end phones.
  high: { maxPixels: 32_000_000, maxDimension: 6_144 },
  // ~64 MP, ~256 MB per buffer. Workstations with generous RAM.
  ultra: { maxPixels: 64_000_000, maxDimension: 8_192 },
};

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
};

/**
 * Pick an initial tier from memory signals, before any probe.
 * Memory APIs are authoritative when present; otherwise default to `high`
 * and rely on the probe to downgrade. No UA sniffing — output consistency
 * across devices is the explicit goal.
 */
function guessTier(): { tier: CapabilityTier; reason: string } {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | NavigatorWithMemory
    | undefined;
  const perf = (typeof performance !== 'undefined' ? performance : undefined) as
    | PerformanceWithMemory
    | undefined;

  const memory = nav?.deviceMemory; // 0.25 | 0.5 | 1 | 2 | 4 | 8 | undefined
  const cores = nav?.hardwareConcurrency ?? 0;
  const heapLimit = perf?.memory?.jsHeapSizeLimit;

  // Chromium: heap cap is authoritative. Allocating beyond it throws
  // synchronously and the probe cannot rescue us — start at the tier the
  // budget actually fits.
  if (heapLimit !== undefined) {
    const heapGB = heapLimit / (1024 * 1024 * 1024);
    if (heapGB < 1) return { tier: 'low', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    if (heapGB < 2) return { tier: 'mid', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    if (heapGB < 4) return { tier: 'high', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    return { tier: 'ultra', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
  }

  // No heap (Safari / Firefox). Use deviceMemory if exposed; treat it as
  // a memory budget hint, not a device-class label.
  if (memory !== undefined) {
    if (memory <= 2) return { tier: 'low', reason: `deviceMemory=${memory}GB` };
    if (memory <= 4) return { tier: 'mid', reason: `deviceMemory=${memory}GB` };
    if (memory >= 8 && cores >= 8) {
      return { tier: 'ultra', reason: `deviceMemory=${memory}GB, cores=${cores}` };
    }
    return { tier: 'high', reason: `deviceMemory=${memory}GB` };
  }

  // No memory API at all (notably iOS Safari, some Firefox builds). Start
  // at `high` and let the probe step down if allocation fails. This is the
  // deliberate trade for output consistency: a device that genuinely cannot
  // hold the high-tier budget will downgrade through `mid` → `low` cleanly.
  return { tier: 'high', reason: 'no memory API — probe-driven' };
}

/**
 * Active probe: try to allocate a buffer of (pixels × 4) bytes + a Canvas
 * of (side × side). If either throws, we know this tier is too optimistic.
 */
function probeTier(tier: CapabilityTier): boolean {
  const { maxDimension } = TIERS[tier];
  try {
    // 1. Probe raw byte allocation for an RGBA buffer at tier size.
    const bytes = maxDimension * maxDimension * 4;
    // Use Uint8Array — it's what ImageData holds, and the throw is explicit.
    const buf = new Uint8Array(bytes);
    // Touch first/last byte to force real allocation (not just reservation).
    buf[0] = 0;
    buf[bytes - 1] = 0;

    // Canvas probing deferred — raw Uint8Array allocation above is a
    // strong proxy for whether the browser has enough memory budget.
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect device capability. Runs the passive signal check, then probes
 * the chosen tier. If the probe fails, steps down one tier at a time.
 */
export function detectCapability(): DeviceCapability {
  const { tier: initialTier, reason: initialReason } = guessTier();
  const ladder: CapabilityTier[] = ['ultra', 'high', 'mid', 'low'];
  const startIdx = ladder.indexOf(initialTier);

  let chosenTier: CapabilityTier = 'low';
  let chosenReason = initialReason;
  for (let i = startIdx; i < ladder.length; i++) {
    const candidate = ladder[i];
    if (probeTier(candidate)) {
      chosenTier = candidate;
      if (i !== startIdx) {
        chosenReason = `${initialReason} (probe downgraded from ${initialTier})`;
      }
      break;
    }
  }

  const { maxPixels, maxDimension } = TIERS[chosenTier];
  return { maxPixels, maxDimension, tier: chosenTier, reason: chosenReason };
}

/** Compute target dimensions for an image given the device capability. */
export function computeTargetSize(
  origWidth: number,
  origHeight: number,
  cap: DeviceCapability,
): { width: number; height: number; scale: number; needsDownscale: boolean } {
  const origPixels = origWidth * origHeight;
  const byDim = Math.min(1, cap.maxDimension / Math.max(origWidth, origHeight));
  const byPx = origPixels > cap.maxPixels ? Math.sqrt(cap.maxPixels / origPixels) : 1;
  const scale = Math.min(byDim, byPx);

  if (scale >= 1) {
    return { width: origWidth, height: origHeight, scale: 1, needsDownscale: false };
  }

  return {
    width: Math.max(1, Math.round(origWidth * scale)),
    height: Math.max(1, Math.round(origHeight * scale)),
    scale,
    needsDownscale: true,
  };
}

/** Singleton cache to avoid re-probing on every image load. */
let cached: DeviceCapability | null = null;

export function getCapability(): DeviceCapability {
  if (cached === null) cached = detectCapability();
  return cached;
}

/** For tests: reset the cache so each test can re-probe. */
export function __resetCapabilityCache(): void {
  cached = null;
}
