/**
 * Meridian design tokens — single source of truth, mirrored in
 * app/styles/aurora.css. See frontend/DESIGN.md. Never invent colour,
 * size or spacing values in components; `npm run lint:tokens` enforces it.
 */

/** Ink — neutral scale shared by both themes. */
export const ink = {
  0: "#FFFFFF",
  50: "#F3F4F2", // paper
  100: "#E8EAE7", // primary text on dark
  200: "#DADDD8", // rule on paper
  300: "#B9BDB7",
  400: "#8A908B", // muted text on dark
  500: "#646B67", // muted text on paper (5.2:1)
  600: "#4A504D",
  700: "#333836",
  800: "#222628",
  900: "#15181A", // ink: text and primary buttons on paper
  950: "#0C0E0F",
} as const;

/** Canvas. Light (paper) is the default; dark is the alternative. */
export const canvas = {
  light: {
    base: "#F3F4F2", // paper
    raised: "#FFFFFF", // sheet: tables, matrix, drawers
    elevated: "#FFFFFF",
    overlay: "#E8EAE7",
    line: "#DADDD8", // rule
  },
  dark: {
    base: "#141617",
    raised: "#1B1E20",
    elevated: "#222628",
    overlay: "#2A2F32",
    line: "#2C3134",
  },
} as const;

/**
 * Accent: petrol. Selection, focus and links only. Primary actions are
 * ink-solid (`--aurora-action-*`), never the accent.
 */
export const accent = {
  50: "#E6F1F3",
  100: "#C4DDE2",
  200: "#93C2CC",
  300: "#5FA3B2",
  400: "#2F8295",
  500: "#0E5A6B",
  600: "#0B4A58",
  700: "#093C48",
  800: "#072E37",
  900: "#052128",
  dark500: "#4FB3C4",
  selectedBg: "rgba(14, 90, 107, 0.09)",
  selectedBorder: "rgba(14, 90, 107, 0.36)",
} as const;

/** In-flight state (running job). Same petrol; never an outcome. */
export const signal = {
  500: "#0E5A6B",
  bg: "rgba(14, 90, 107, 0.09)",
  border: "rgba(14, 90, 107, 0.36)",
} as const;

/**
 * Status = severity. The only colour besides petrol, so a screen's colour
 * count is its defect count. danger = critical, high = high,
 * warning = medium, success = OK.
 */
export const status = {
  danger: { 500: "#B42318", dark500: "#F0705F", bg: "rgba(180, 35, 24, 0.08)", border: "rgba(180, 35, 24, 0.32)" },
  high: { 500: "#C4500B", dark500: "#F08A4B", bg: "rgba(196, 80, 11, 0.08)", border: "rgba(196, 80, 11, 0.32)" },
  warning: { 500: "#A86A00", dark500: "#E0B04A", bg: "rgba(168, 106, 0, 0.09)", border: "rgba(168, 106, 0, 0.32)" },
  success: { 500: "#23794A", dark500: "#5CC48A", bg: "rgba(35, 121, 74, 0.08)", border: "rgba(35, 121, 74, 0.30)" },
  info: { 500: "#0E5A6B", dark500: "#4FB3C4", bg: "rgba(14, 90, 107, 0.09)", border: "rgba(14, 90, 107, 0.36)" },
} as const;

/** Data visualisation (light values; aurora.css carries the dark set). */
export const viz = {
  categorical: [
    "#0E5A6B",
    "#C4500B",
    "#5B6F8A",
    "#A86A00",
    "#6D5A8E",
    "#23794A",
    "#8E4B5F",
    "#4F8A8B",
    "#7A6A3A",
    "#3D6FA3",
    "#9A5B2E",
    "#646B67",
  ],
  sequential: {
    blue: ["#E6F1F3", "#C4DDE2", "#93C2CC", "#5FA3B2", "#2F8295", "#0E5A6B"],
    amber: ["#F7EEDC", "#ECD5A6", "#DBB76A", "#C4952F", "#A86A00", "#7A4D00"],
  },
  diverging: {
    redGreen: ["#B42318", "#D9776D", "#EFC4BF", "#DADDD8", "#B9DCC7", "#5FA67D", "#23794A"],
  },
} as const;

/** Retired. The product has no gradients. Kept so old imports resolve. */
export const verdictHalo = "none";

/** Type faces: Atkinson Hyperlegible Next (UI), Atkinson Hyperlegible Mono (SAP identifiers only). */
export const faces = {
  display: "var(--aurora-font-display)",
  ui: "var(--aurora-font-ui)",
  mono: "var(--aurora-font-mono)",
} as const;

/** Two radii: controls and sheets. */
export const radius = { control: 4, sheet: 6 } as const;

/**
 * §5.3.2 — Type scale. Six sizes. Not seven. Not ten. New sizes require a
 * scope-review issue per §16.1. Exported as `typography` to avoid shadowing
 * the `type` keyword in import/export contexts.
 */
export const typography = {
  "text-micro": { size: 11, lineHeight: 14, tracking: "0.01em" },
  "text-small": { size: 13, lineHeight: 18, tracking: "0.02em" },
  "text-body": { size: 14, lineHeight: 20, tracking: "0" },
  "text-lead": { size: 17, lineHeight: 24, tracking: "0" },
  "display-sm": { size: 24, lineHeight: 30, tracking: "-0.01em" },
  "display-lg": { size: 40, lineHeight: 44, tracking: "-0.02em" },
} as const;

/** §5.3.3 — Numerical formatting. Tabular, lining, stylistic set 02. */
export const numberFontFeatures = '"tnum" 1, "lnum" 1';

/** §5.4 — Four-pixel base spacing grid. Every value is a multiple of 4. */
export const space = {
  "space-1": 4,
  "space-2": 8,
  "space-3": 12,
  "space-4": 16,
  "space-5": 20,
  "space-6": 24,
  "space-8": 32,
  "space-12": 48,
  "space-16": 64,
  "space-24": 96,
} as const;

/** Elevation. Sheets sit flat on paper; shadow only on overlays (2, 3). */
export const elevation = {
  0: { dark: "var(--aurora-canvas-base)", light: "var(--aurora-canvas-base)", shadow: "none" },
  1: { dark: "var(--aurora-canvas-raised)", light: "var(--aurora-canvas-raised)", shadow: "none" },
  2: { dark: "var(--aurora-canvas-elevated)", light: "var(--aurora-canvas-elevated)", shadow: "0 4px 12px rgba(21, 24, 26, 0.08)" },
  3: { dark: "var(--aurora-canvas-elevated)", light: "var(--aurora-canvas-elevated)", shadow: "0 12px 32px rgba(21, 24, 26, 0.16)" },
  4: { dark: "var(--aurora-canvas-raised)", light: "var(--aurora-canvas-raised)", shadow: "none" },
} as const;

/** §5.8 — Icon size tokens. Aurora icons render at exactly these sizes. */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

/** §7.3 — Focus ring token. Used by every interactive component. */
export const focusRing = {
  width: 2,
  offset: 2,
  colour: "var(--aurora-accent-500)",
} as const;
