/**
 * Aurora motion tokens — §5.5.
 *
 * Four durations, three easings, two springs. That is the entire motion
 * vocabulary for the product. Every animation references one of these
 * tokens — no inline timing, ever. Motion communicates state change; it
 * is never ornamental. §16.1.
 */

/** §5.5 — Durations in milliseconds. */
export const duration = {
  instant: 80, // state toggle, focus ring, hover
  fast: 160, // menu open, popover, toast
  medium: 240, // drawer open, page transition
  slow: 360, // verdict card entrance, process graph materialise
} as const;

/** §5.5 — CSS easing functions. */
export const easing = {
  standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  enter: "cubic-bezier(0, 0, 0.2, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** §5.5 — Framer-Motion spring configs. Two variants only. */
export const spring = {
  drawer: { type: "spring" as const, damping: 26, stiffness: 240, mass: 1 },
  kanban: { type: "spring" as const, damping: 20, stiffness: 300, mass: 0.8 },
} as const;

/**
 * Convenience helper for CSS `transition` shorthand. Callers pass a property
 * and a named duration / easing; the helper composes the string.
 *
 * Example:
 *   transition('opacity', 'fast')
 *   // → 'opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1)'
 */
export function transition(
  property: string,
  dur: keyof typeof duration = "fast",
  ease: keyof typeof easing = "standard",
): string {
  return `${property} ${duration[dur]}ms ${easing[ease]}`;
}
