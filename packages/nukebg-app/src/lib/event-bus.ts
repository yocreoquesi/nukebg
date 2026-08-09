/**
 * Typed contract for every cross-component custom event in the app.
 *
 * Closes the audit-#98 finding about leaked document-level listeners
 * (the `boundLocaleHandler` pattern across 8 components) by giving
 * callers an `on()` helper that ties cleanup to an `AbortSignal`. Also
 * removes the `(e as CustomEvent<...>).detail` casts at every consumer
 * — the bus knows the payload shape from the event name alone.
 *
 * The map below is the **single source of truth** for cross-component
 * events. Adding a new event = add a line here; everywhere else picks
 * up the type automatically. Don't dispatch a `CustomEvent` with a key
 * that isn't in this map — the helpers won't accept it.
 *
 * Spun out of #47 Phase 4, tracked under #217.
 */

/** Map every public custom-event name to its detail payload. Use
 *  `undefined` for events with no payload — callers then pass
 *  `undefined` explicitly so the event surface stays grep-able. */
export interface NukeBgEventMap {
  // ── Pipeline / image lifecycle ───────────────────────────────────
  'ar:image-loaded': {
    file: File;
    imageData: ImageData;
    originalImageData: ImageData;
    originalWidth: number;
    originalHeight: number;
    wasDownsampled: boolean;
  };
  'ar:images-loaded': {
    images: Array<{
      file: File;
      imageData: ImageData;
      originalImageData: ImageData;
      originalWidth: number;
      originalHeight: number;
      wasDownsampled: boolean;
    }>;
  };
  'ar:cancel-processing': undefined;
  'ar:nuke-success': undefined;
  'ar:process-another': undefined;

  // ── Progress / stage actions ─────────────────────────────────────
  'ar:stage-retry': { stage: string };
  'ar:stage-report': { stage: string };

  // ── Editor handoff ───────────────────────────────────────────────
  'ar:editor-cancel': undefined;
  'ar:editor-done': { imageData: ImageData };
  'ar:advanced-cancel': undefined;
  'ar:advanced-done': { imageData: ImageData };

  // ── Batch grid ───────────────────────────────────────────────────
  'batch:item-click': { id: string; state: string };
  'batch:download-zip': undefined;
  'batch:cancel': undefined;

  // ── App-wide signals ─────────────────────────────────────────────
  'nukebg:locale-changed': { locale: string };
  'nukebg:pwa-installable': undefined;
  'nukebg:sw-update-available': undefined;
}

export type NukeBgEventName = keyof NukeBgEventMap;

export interface EmitOptions {
  /** Cross shadow-root + DOM tree boundaries. Default: false. */
  bubbles?: boolean;
  /** Allow the event to escape its shadow root. Default: false. */
  composed?: boolean;
}

/** Dispatch a typed custom event. Compile-time checks the name AND the
 *  detail shape against `NukeBgEventMap`. */
export function emit<K extends NukeBgEventName>(
  target: EventTarget,
  name: K,
  detail: NukeBgEventMap[K],
  opts: EmitOptions = {},
): void {
  target.dispatchEvent(
    new CustomEvent(name, {
      detail,
      bubbles: opts.bubbles ?? false,
      composed: opts.composed ?? false,
    }),
  );
}

/** Subscribe to a typed custom event. Always pass an `AbortSignal` so
 *  cleanup ties to the host's lifecycle — no manual `removeEventListener`
 *  pattern, no leaked listeners on `disconnectedCallback` bugs. */
export function on<K extends NukeBgEventName>(
  target: EventTarget,
  name: K,
  handler: (detail: NukeBgEventMap[K], event: CustomEvent<NukeBgEventMap[K]>) => void,
  opts: AddEventListenerOptions & { signal: AbortSignal },
): void {
  const wrapped = (e: Event): void => {
    const ce = e as CustomEvent<NukeBgEventMap[K]>;
    handler(ce.detail, ce);
  };
  target.addEventListener(name, wrapped, opts);
}
