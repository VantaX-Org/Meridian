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
  accentHover: "var(--m-accent-hover)",
  accentInk: "var(--m-accent-ink)",
  sheetSunken: "var(--m-sheet-sunken)",
  rail: "var(--m-rail)",
  lineStrong: "var(--m-line-strong)",
  ink4: "var(--m-ink-4)",
  inkOnAccent: "var(--m-ink-on-accent)",
  criticalSoft: "var(--m-critical-soft)",
  highSoft: "var(--m-high-soft)",
  mediumSoft: "var(--m-medium-soft)",
  passSoft: "var(--m-pass-soft)",
  criticalInk: "var(--m-critical-ink)",
  highInk: "var(--m-high-ink)",
  mediumInk: "var(--m-medium-ink)",
  passInk: "var(--m-pass-ink)",
  vizArea: "var(--m-viz-area)",
  vizTooltipBg: "var(--m-viz-tooltip-bg)",
  vizTooltipInk: "var(--m-viz-tooltip-ink)",
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

// Mirrors tokens.css radii.
export const mRadius = { control: 6, sheet: 10, tile: 14, pill: 999 } as const;

export const mMotion = { duration: 120, slow: 240, draw: 480, shimmer: 1400, ease: "cubic-bezier(0.2, 0, 0, 1)" } as const;

/** Elevation levels: flat (hairline), raised (menus), floating (drawer, dialog, palette), plus focus ring. */
export const mElev = {
  flat: "var(--m-elev-1)",
  raised: "var(--m-elev-2)",
  floating: "var(--m-elev-3)",
  focus: "var(--m-elev-focus)",
} as const;

/** Colour key for a DQS score: >= target pass, >= warning medium, >= critical high, else critical. */
export function dqsBand(
  score: number,
  bands: { target: number; warning: number; critical: number },
): "pass" | "medium" | "high" | "critical" {
  if (score >= bands.target) return "pass";
  if (score >= bands.warning) return "medium";
  if (score >= bands.critical) return "high";
  return "critical";
}

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
