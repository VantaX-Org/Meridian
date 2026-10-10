// frontend/design/tokens.ts
/** Typed access to design/tokens.css's values, for charts and inline styles. */

export const mColor = {
  canvas: "var(--m-canvas)",
  sheet: "var(--m-sheet)",
  sheetRaised: "var(--m-sheet-raised)",
  line: "var(--m-line)",
  ink: "var(--m-ink)",
  ink2: "var(--m-ink-2)",
  ink3: "var(--m-ink-3)",
  accent: "var(--m-accent)",
  accentSoft: "var(--m-accent-soft)",
  critical: "var(--m-critical)",
  high: "var(--m-high)",
  medium: "var(--m-medium)",
  pass: "var(--m-pass)",
  viz: [
    "var(--m-viz-1)",
    "var(--m-viz-2)",
    "var(--m-viz-3)",
    "var(--m-viz-4)",
    "var(--m-viz-5)",
    "var(--m-viz-6)",
    "var(--m-viz-7)",
    "var(--m-viz-8)",
  ] as const,
} as const;

export const mSpace = {
  1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64, 24: 96,
} as const;

export const mRadius = { control: 4, sheet: 6 } as const;

export const mMotion = { duration: 120, slow: 320, draw: 640, shimmer: 1400, ease: "ease-out" as const };

/** True when the user has asked the OS for reduced motion; JS animations jump to the end state. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** critical=square, high=triangle, medium=circle, low=ring, pass=check (spec 4.4). */
export type Severity = "critical" | "high" | "medium" | "low" | "pass";
export const severityShape: Record<Severity, "square" | "triangle" | "circle" | "ring" | "check"> = {
  critical: "square",
  high: "triangle",
  medium: "circle",
  low: "ring",
  pass: "check",
};
export const severityColor: Record<Severity, string> = {
  critical: mColor.critical,
  high: mColor.high,
  medium: mColor.medium,
  low: mColor.ink3,
  pass: mColor.pass,
};

/** Narrows a severity string from the API to the five values the design system paints. */
export function isSeverity(value: string): value is Severity {
  return value in severityColor;
}
