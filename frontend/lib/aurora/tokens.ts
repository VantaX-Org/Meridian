/**
 * Aurora design tokens — single source of truth.
 *
 * These values are fixed by the Aurora Experience Spec §5. Never invent,
 * tweak, or compute new colour / size / spacing values in components.
 * Token drift is a CI-enforceable violation (§D3).
 */

/** §5.1.1 — Ink (text and foreground). Twelve stops. */
export const ink = {
  0: "#FFFFFF", // pure white — used rarely, only on luminous overlays
  50: "#F7F8FA", // highest-contrast text on deep canvas
  100: "#E7ECF2", // body text on dark canvas
  200: "#C7D0DC", // secondary text on dark canvas
  300: "#99A5B8", // tertiary / muted
  400: "#6B7A90", // subdued metadata
  500: "#4A5669", // disabled
  600: "#2E3847", // borders on light canvas
  700: "#1A2230", // light-canvas body text
  800: "#101622", // near-ink
  900: "#0A0E1A", // ink, headlines on light canvas
  950: "#05070F", // deepest, rarely used
} as const;

/** §5.1.2 — Canvas (backgrounds). Dark is default; light is alternative. */
export const canvas = {
  dark: {
    base: "#0A0E1A", // product canvas — matches ink.900
    raised: "#111726", // cards, drawers
    elevated: "#172034", // popovers, command palette
    overlay: "#1E2A42", // hover / selected
    line: "#2A3654", // dividers
  },
  light: {
    base: "#F7F8FA", // matches ink.50
    raised: "#FFFFFF",
    elevated: "#FFFFFF",
    overlay: "#EEF2F7",
    line: "#D5DADD",
  },
} as const;

/**
 * §5.1.3 — Accent (SAP Fiori Horizon blue, one shade deeper for composure
 * on dark canvases). Used for primary actions, selected state, focus ring,
 * and the verdict halo gradient.
 */
export const accent = {
  50: "#EAF3FE",
  100: "#CAE0FC",
  200: "#8FC1F8",
  300: "#549FF2",
  400: "#2980E8",
  500: "#0057D2", // primary
  600: "#0048AD",
  700: "#003A8C",
  800: "#002D6F",
  900: "#001F50",
  /** Selected-state fills derived from accent.500 — used by chips,
      filter pills, and any data-selected="true" surface. Separate
      variables keep call sites free of raw rgba() drift. */
  selectedBg: "rgba(0, 87, 210, 0.18)",
  selectedBorder: "rgba(0, 87, 210, 0.32)",
} as const;

/**
 * §5.1.4 — Semantic status. Used exclusively for status. Never for
 * decoration or brand emphasis. A button is never danger-coloured unless
 * it performs a destructive action.
 */
export const status = {
  success: {
    500: "#0B7341",
    bg: "rgba(11, 115, 65, 0.12)",
    border: "rgba(11, 115, 65, 0.32)",
  },
  warning: {
    500: "#C78420",
    bg: "rgba(199, 132, 32, 0.12)",
    border: "rgba(199, 132, 32, 0.32)",
  },
  danger: {
    500: "#BB0000",
    bg: "rgba(187, 0, 0, 0.14)",
    border: "rgba(187, 0, 0, 0.36)",
  },
  info: {
    500: "#0057D2",
    bg: "rgba(0, 87, 210, 0.10)",
    border: "rgba(0, 87, 210, 0.30)",
  },
} as const;

/**
 * §5.1.5 — Data visualisation palette. Twelve-colour ordinal categorical,
 * tuned for dark canvases. Never invent or substitute — iterate in order.
 */
export const viz = {
  categorical: [
    "#54A0FF", // luminous blue
    "#E76500", // Fiori orange (brand link)
    "#30D5A8", // mint
    "#FFBA6B", // peach
    "#A77DFF", // violet
    "#F87AC4", // rose
    "#6AE6F5", // cyan
    "#F5D76E", // gold
    "#7BD389", // fern
    "#FF8A65", // coral
    "#96B6FF", // periwinkle
    "#D8A2DC", // orchid
  ],
  sequential: {
    blue: ["#0F1D3D", "#1A3E85", "#2D5FC8", "#5488F1", "#8FB4FF", "#D0E2FF"],
    amber: ["#2A1A00", "#4F3100", "#7F5200", "#B57A1D", "#E8A656", "#FFCE99"],
  },
  diverging: {
    redGreen: [
      "#BB0000",
      "#E87272",
      "#F5BABA",
      "#D5DADD",
      "#B8E4C6",
      "#5DC488",
      "#0B7341",
    ],
  },
} as const;

/**
 * §5.2 — The only gradient in Aurora. Rendered behind the verdict sentence
 * on the Command Centre at 15% opacity. Any other gradient anywhere is a bug.
 */
export const verdictHalo =
  "radial-gradient(ellipse at center, rgba(0, 87, 210, 0.24) 0%, rgba(106, 230, 245, 0.14) 35%, rgba(248, 122, 196, 0.08) 60%, transparent 80%)";

/** §5.3.1 — Type faces. Söhne is preferred; Inter is the open-source fallback. */
export const faces = {
  display:
    "var(--aurora-font-display), Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  ui: "var(--aurora-font-ui), Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "var(--aurora-font-mono), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/**
 * §5.3.2 — Type scale. Six sizes. Not seven. Not ten. New sizes require a
 * scope-review issue per §16.1. Exported as `typography` to avoid shadowing
 * the `type` keyword in import/export contexts.
 */
export const typography = {
  "text-micro": { size: 11, lineHeight: 14, tracking: "0.08em" },
  "text-small": { size: 13, lineHeight: 18, tracking: "0.02em" },
  "text-body": { size: 14, lineHeight: 20, tracking: "0" },
  "text-lead": { size: 17, lineHeight: 24, tracking: "0" },
  "display-sm": { size: 24, lineHeight: 30, tracking: "-0.01em" },
  "display-lg": { size: 40, lineHeight: 44, tracking: "-0.02em" },
} as const;

/** §5.3.3 — Numerical formatting. Tabular, lining, stylistic set 02. */
export const numberFontFeatures = '"tnum" 1, "lnum" 1, "ss02" 1';

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

/** §5.6 — Elevation. Five levels. Dark = brightness shift, light = shadow. */
export const elevation = {
  0: {
    dark: "var(--aurora-canvas-base)",
    light: "var(--aurora-canvas-base)",
    shadow: "none",
  },
  1: {
    dark: "var(--aurora-canvas-raised)",
    light: "var(--aurora-canvas-raised)",
    shadow: "0 1px 2px rgba(10, 14, 26, 0.06)",
  },
  2: {
    dark: "var(--aurora-canvas-elevated)",
    light: "var(--aurora-canvas-elevated)",
    shadow: "0 2px 8px rgba(10, 14, 26, 0.08)",
  },
  3: {
    dark: "var(--aurora-canvas-elevated)",
    light: "var(--aurora-canvas-elevated)",
    shadow: "0 8px 24px rgba(10, 14, 26, 0.12)",
  },
  4: {
    dark: "var(--aurora-canvas-elevated)",
    light: "var(--aurora-canvas-elevated)",
    shadow: "0 16px 40px rgba(10, 14, 26, 0.16)",
    glow: "0 0 0 1px rgba(0, 87, 210, 0.40), 0 0 48px rgba(0, 87, 210, 0.24)",
  },
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
