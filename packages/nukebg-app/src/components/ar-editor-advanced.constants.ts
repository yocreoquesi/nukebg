/**
 * Brush sizing bounds for <ar-editor-advanced>.
 *
 * These three live outside the component because two places need them and
 * neither should own the other: the component clamps `brushRadius` against
 * them in setBrushRadius(), and ar-editor-advanced.template.ts renders them
 * as the range slider's min/max/value. Before the #255 split the template
 * read them as module locals; extracting the template would otherwise have
 * meant either a circular import or passing them in as arguments, and the
 * template deliberately takes no arguments — see its header for why.
 *
 * Values are a RADIUS in image-space pixels, not a diameter. The old
 * ar-editor.ts used a diameter, which is why its slider read min="2".
 */
export const DEFAULT_BRUSH = 24;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 120;
