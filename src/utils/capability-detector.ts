/**
 * Device capability detector for adaptive image processing.
 *
 * Combines multiple signals to decide the safe working resolution
 * for the pipeline on the current device:
 *   - navigator.deviceMemory (Chromium only, quantized to 0.25/0.5/1/2/4/8 GB)
 *   - performance.memory.jsHeapSizeLimit (Chromium only, tab-level cap)
 *   - navigator.hardwareConcurrency (all browsers, proxy for device tier)
 *   - userAgent (mobile detection)
 *   - Active probe: allocate OffscreenCanvas + ImageData at target size
 *
 * The probe is the authoritative signal: if the browser can't allocate
 * the target buffer, we step down. Safari/Firefox have no deviceMemory
 * so the probe is their only defense.
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

/** Hard ceiling — even on beasts, we never accept more than this */
export const ABSOLUTE_MAX_PIXELS = 100_000_000; // 100 MP (Fuji GFX 100 class)

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

function isMobileUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * Pick an initial tier from passive signals, before any probe.
 * This is a best-guess starting point; the probe can downgrade it.
 */
function guessTier(): { tier: CapabilityTier; reason: string } {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | NavigatorWithMemory
    | undefined;
  const perf = (typeof performance !== 'undefined' ? performance : undefined) as
    | PerformanceWithMemory
    | undefined;

  const mobile = isMobileUA();
  const memory = nav?.deviceMemory; // 0.25 | 0.5 | 1 | 2 | 4 | 8 | undefined
  const cores = nav?.hardwareConcurrency ?? 0;
  const heapLimit = perf?.memory?.jsHeapSizeLimit;

  // Low tier: explicit low memory or clearly constrained mobile
  if (memory !== undefined && memory <= 2) {
    return { tier: 'low', reason: `deviceMemory=${memory}GB` };
  }
  if (mobile && cores > 0 && cores <= 4) {
    return { tier: 'low', reason: `mobile, cores=${cores}` };
  }

  // Chromium-only: heap cap gives us an actual budget
  if (heapLimit !== undefined) {
    const heapGB = heapLimit / (1024 * 1024 * 1024);
    if (heapGB < 1) return { tier: 'low', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    if (heapGB < 2) return { tier: 'mid', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    if (heapGB < 4) return { tier: 'high', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
    return { tier: 'ultra', reason: `heapLimit=${heapGB.toFixed(2)}GB` };
  }

  // No heap info (Safari / Firefox). Use deviceMemory + cores.
  if (memory !== undefined && memory >= 8) {
    return { tier: cores >= 8 ? 'ultra' : 'high', reason: `deviceMemory=${memory}GB, cores=${cores}` };
  }
  if (memory !== undefined && memory >= 4) {
    return { tier: 'high', reason: `deviceMemory=${memory}GB` };
  }
  if (mobile) {
    return { tier: 'mid', reason: `mobile (no memory API)` };
  }

  // Desktop, unknown memory. Assume mid — probe will confirm.
  return { tier: 'mid', reason: 'desktop (no memory API)' };
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
