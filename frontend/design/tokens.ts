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
    "var(--m-viz-9)",
    "var(--m-viz-10)",
  ] as const,
  ember: "var(--m-ember)",
  emberSoft: "var(--m-ember-soft)",
  emberInk: "var(--m-ember-ink)",
  emberOn: "var(--m-ember-on)",
  /** Domain solids. Resolve a module id through `domainOf` first. */
  dom: {
    material: "var(--m-dom-material)",
    customer: "var(--m-dom-customer)",
    vendor: "var(--m-dom-vendor)",
    partner: "var(--m-dom-partner)",
    finance: "var(--m-dom-finance)",
    people: "var(--m-dom-people)",
    plant: "var(--m-dom-plant)",
    asset: "var(--m-dom-asset)",
    other: "var(--m-dom-other)",
  },
  domSoft: {
    material: "var(--m-dom-material-soft)",
    customer: "var(--m-dom-customer-soft)",
    vendor: "var(--m-dom-vendor-soft)",
    partner: "var(--m-dom-partner-soft)",
    finance: "var(--m-dom-finance-soft)",
    people: "var(--m-dom-people-soft)",
    plant: "var(--m-dom-plant-soft)",
    asset: "var(--m-dom-asset-soft)",
    other: "var(--m-dom-other-soft)",
  },
  domInk: {
    material: "var(--m-dom-material-ink)",
    customer: "var(--m-dom-customer-ink)",
    vendor: "var(--m-dom-vendor-ink)",
    partner: "var(--m-dom-partner-ink)",
    finance: "var(--m-dom-finance-ink)",
    people: "var(--m-dom-people-ink)",
    plant: "var(--m-dom-plant-ink)",
    asset: "var(--m-dom-asset-ink)",
    other: "var(--m-dom-other-ink)",
  },
  /** Sequential ramp, step 1 (lightest) to 5. Text on a step: `seqInk(step)`. */
  seq: ["var(--m-seq-1)", "var(--m-seq-2)", "var(--m-seq-3)", "var(--m-seq-4)", "var(--m-seq-5)"] as const,
  /** Diverging ramp, negative end to positive end. */
  div: ["var(--m-div-neg-2)", "var(--m-div-neg-1)", "var(--m-div-mid)", "var(--m-div-pos-1)", "var(--m-div-pos-2)"] as const,
  /** Hero surface inks and tone solids. The hero is dark in both themes. */
  hero: {
    bg: "var(--m-hero-bg)",
    bg2: "var(--m-hero-bg-2)",
    ink: "var(--m-hero-ink)",
    ink2: "var(--m-hero-ink-2)",
    ink3: "var(--m-hero-ink-3)",
    line: "var(--m-hero-line)",
    toneCritical: "var(--m-hero-tone-critical)",
    toneHigh: "var(--m-hero-tone-high)",
    toneMedium: "var(--m-hero-tone-medium)",
    tonePass: "var(--m-hero-tone-pass)",
  },
} as const;

/** The nine SAP object families that carry a domain hue. */
export type DomainKey = "material" | "customer" | "vendor" | "partner" | "finance" | "people" | "plant" | "asset" | "other";

export const domainKeys: readonly DomainKey[] = ["material", "customer", "vendor", "partner", "finance", "people", "plant", "asset", "other"];

/** Human label for a domain, sentence case. */
export const domainLabel: Record<DomainKey, string> = {
  material: "Material",
  customer: "Customer",
  vendor: "Vendor",
  partner: "Business partner",
  finance: "Finance",
  people: "People",
  plant: "Plant",
  asset: "Fixed asset",
  other: "Other",
};

// First match wins, so specific prefixes come before general ones.
const DOMAIN_PREFIXES: ReadonlyArray<readonly [string, DomainKey]> = [
  ["business_partner", "partner"], ["partner", "partner"], ["bp_", "partner"], ["contact", "partner"], ["relationship", "partner"],
  ["material", "material"], ["bom", "material"], ["routing", "material"], ["classification", "material"], ["batch", "material"],
  ["sd_customer", "customer"], ["sd_sales", "customer"], ["customer", "customer"], ["sales", "customer"], ["credit", "customer"],
  ["mm_purchasing", "vendor"], ["vendor", "vendor"], ["supplier", "vendor"], ["purchasing", "vendor"], ["ariba", "vendor"],
  ["fixed_asset", "asset"], ["asset", "asset"],
  ["accounts_payable", "finance"], ["accounts_receivable", "finance"], ["fi_", "finance"], ["gl_", "finance"], ["cost", "finance"],
  ["controlling", "finance"], ["profit", "finance"], ["bank", "finance"], ["company_code", "finance"], ["tax", "finance"], ["concur_expense", "finance"],
  ["successfactors", "people"], ["employee", "people"], ["position", "people"], ["org_unit", "people"], ["payroll", "people"], ["hcm", "people"],
  ["benefits", "people"], ["compensation", "people"], ["learning", "people"], ["performance", "people"], ["recruiting", "people"],
  ["succession", "people"], ["time_attendance", "people"], ["concur_users", "people"],
  ["plant", "plant"], ["storage", "plant"], ["work_center", "plant"], ["equipment", "plant"], ["functional_location", "plant"],
  ["production", "plant"], ["quality", "plant"], ["ewms", "plant"], ["wm_", "plant"], ["fleet", "plant"], ["transport", "plant"],
];

/** SAP module codes, matched exactly (a prefix match would catch unrelated words such as "position"). */
const MODULE_CODES: Readonly<Record<string, DomainKey>> = {
  mm: "material", sd: "customer", fi: "finance", co: "finance", hr: "people", hcm: "people", sf: "people",
  pm: "asset", eam: "asset", pp: "plant", qm: "plant", wm: "plant", ewm: "plant",
};

/** Owning domain of a module id. Unmapped ids fall back to `other`. Pages never hard-code a domain. */
export function domainOf(moduleId: string | null | undefined): DomainKey {
  if (!moduleId) return "other";
  const id = moduleId.toLowerCase().split(/[./:]/).pop() ?? "";
  if (Object.hasOwn(MODULE_CODES, id)) return MODULE_CODES[id];
  for (const [prefix, key] of DOMAIN_PREFIXES) if (id.startsWith(prefix)) return key;
  return "other";
}

/** Ink token for text drawn on a ramp step (1 to 5): ink on steps 1 to 3, on-accent ink on 4 and 5. */
export function seqInk(step: number): string {
  return step <= 3 ? "var(--m-ink)" : "var(--m-ink-on-accent)";
}

/** Ink token for text on a diverging step (0 to 4): on-accent ink on the two ends. */
export function divInk(step: number): string {
  return step === 0 || step === 4 ? "var(--m-ink-on-accent)" : "var(--m-ink)";
}

/** Quintile step (1 to 5) of `value` between `min` and `max`. */
export function rampStep(value: number, min: number, max: number): 1 | 2 | 3 | 4 | 5 {
  if (max <= min) return 1;
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (Math.min(4, Math.floor(t * 5)) + 1) as 1 | 2 | 3 | 4 | 5;
}

export const mSpace = {
  1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64, 24: 96,
} as const;

// Mirrors tokens.css radii.
export const mRadius = { control: 6, sheet: 10, tile: 14, pill: 999 } as const;

export const mMotion = {
  duration: 120, slow: 240, draw: 480, count: 900, shimmer: 1400, staggerStep: 40, staggerBar: 20,
  ease: "cubic-bezier(0.2, 0, 0, 1)",
  easeSpring: "cubic-bezier(0.34, 1.2, 0.64, 1)",
} as const;

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
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  low: "var(--m-low)",
  pass: mColor.pass,
};

/** Narrows a severity string from the API to the five values the design system paints. */
export function isSeverity(value: string): value is Severity {
  return value in severityColor;
}
