/**
 * Score maths and wording for the Meridian 2 ruler, shared by the map, the matrix and the object canvas.
 * Pure functions only: geometry is computed here so it can be tested without a DOM.
 */
import { DIMENSIONS, type DimensionKey, type Verdict } from "@/lib/api/v2/types";

export const DASH = "—";

/** One decimal, or a dash for a value the API did not store. */
export function f1(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? DASH : (Math.round(n * 10) / 10).toFixed(1);
}

/** Whole number with thousands separators (en-US, so it is stable across test and browser locales), or a dash. */
export function int(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? DASH : Math.round(n).toLocaleString("en-US");
}

/** A 0 to 1 share as a percentage with one decimal ("97.4%"), or a dash. */
export function pct1(share: number | null | undefined): string {
  return share == null || Number.isNaN(share) ? DASH : `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

export const VERDICT_LABEL: Record<Verdict, string> = { "no-go": "No-go", "at-risk": "At risk", go: "Go" };

/** The weight each dimension carries in the score, as whole percentages (25, 25, 20, 10, 10, 10). */
export const WEIGHT_PERCENT: readonly number[] = DIMENSIONS.map((d) => Math.round(d.weight * 100));

export type RulerSize = 48 | 240;

export interface RulerSegment {
  key: DimensionKey;
  label: string;
  /** Segment left edge and width, in drawing units. */
  x: number;
  width: number;
  /** The filled part: from the bottom up to the dimension score. */
  fillY: number;
  fillHeight: number;
  /** Null when the dimension was not measured: the track is drawn empty. */
  score: number | null;
}

export interface RulerGeometry {
  size: RulerSize;
  /** The drawing's own size (viewBox). At 240 it includes the axis gutter and the cap labels. */
  viewWidth: number;
  viewHeight: number;
  /** The plot: where the six segments sit. */
  plot: { left: number; top: number; width: number; height: number };
  gap: number;
  segments: RulerSegment[];
  /** Y of the measured tick, or null when there is no measured score. */
  tickY: number | null;
  /** Scale marks, present at 240 only. */
  axis: { y: number; value: number; label: string; kind: "scale" | "band" }[];
  caps: { y: number; value: number; label: string }[];
}

const SMALL = { height: 12, gap: 1 } as const;
const LARGE = { height: 140, top: 8, left: 72, width: 240, right: 100, gap: 2 } as const;

/** Y position (top = 100, bottom = 0) of a score inside a plot of this top and height. */
export function scoreY(score: number, top: number, height: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return Math.round((top + height * (1 - clamped / 100)) * 100) / 100;
}

/**
 * The ruler's drawing. Six segments side by side whose widths are the dimension weights (25/25/20/10/10/10), each
 * filled from the bottom to its own score, and a tick across all of them at the measured score. The 48 size is a bar
 * and a tick; the 240 size adds the 0 to 100 axis with the 60, 75 and 90 band marks and the 70 and 85 cap ticks.
 */
export function rulerGeometry(size: RulerSize, dims: ReadonlyArray<number | null>, measured: number | null): RulerGeometry {
  const large = size === 240;
  const plotW = large ? LARGE.width : size;
  const height = large ? LARGE.height : SMALL.height;
  const top = large ? LARGE.top : 0;
  const left = large ? LARGE.left : 0;
  const gap = large ? LARGE.gap : SMALL.gap;
  const usable = plotW - gap * (DIMENSIONS.length - 1);
  let x = left;
  const segments: RulerSegment[] = DIMENSIONS.map((d, i) => {
    const width = usable * d.weight;
    const score = dims[i] ?? null;
    const fillHeight = score == null ? 0 : (height * Math.max(0, Math.min(100, score))) / 100;
    const seg: RulerSegment = {
      key: d.key,
      label: d.label,
      x: Math.round(x * 100) / 100,
      width: Math.round(width * 100) / 100,
      fillY: Math.round((top + height - fillHeight) * 100) / 100,
      fillHeight: Math.round(fillHeight * 100) / 100,
      score,
    };
    x += width + gap;
    return seg;
  });
  const tickY = measured == null ? null : scoreY(measured, top, height);
  const axis: RulerGeometry["axis"] = [];
  const caps: RulerGeometry["caps"] = [];
  if (large) {
    for (const v of [0, 25, 50, 100]) axis.push({ y: scoreY(v, top, height), value: v, label: String(v), kind: "scale" });
    axis.push({ y: scoreY(60, top, height), value: 60, label: "60 critical", kind: "band" });
    axis.push({ y: scoreY(75, top, height), value: 75, label: "75 at risk", kind: "band" });
    axis.push({ y: scoreY(90, top, height), value: 90, label: "90 go", kind: "band" });
    caps.push({ y: scoreY(85, top, height), value: 85, label: "cap 1 critical" });
    caps.push({ y: scoreY(70, top, height), value: 70, label: "cap 2 or more" });
  }
  return {
    size,
    viewWidth: large ? LARGE.left + LARGE.width + LARGE.right : plotW,
    viewHeight: top + height + (large ? 4 : 0),
    plot: { left, top, width: plotW, height },
    gap,
    segments,
    tickY,
    axis,
    caps,
  };
}

/** The share of the plot width each segment takes, in percent. They sum to 100 by construction. */
export function segmentShares(g: RulerGeometry): number[] {
  const usable = g.plot.width - g.gap * (g.segments.length - 1);
  return g.segments.map((s) => (s.width / usable) * 100);
}

export interface Reading {
  label: string;
  measured: number | null;
  score: number | null;
  capped: boolean;
  capLevel: number | null;
  breaches: readonly string[];
  dims: ReadonlyArray<number | null>;
  records: number | null;
  rules: number | null;
  coverage: number | null;
  lowConfidence: boolean;
}

/** Names the capping rules: "MM014 and MM031", or the count when there are more than two. */
export function breachNames(breaches: readonly string[]): string {
  if (breaches.length === 0) return "";
  if (breaches.length <= 2) return breaches.join(" and ");
  return `${breaches.length} critical rules over tolerance`;
}

/** The full reading of a score, the text of the ruler's title and accessible name. */
export function readingText(r: Reading): string {
  const capAt = r.capLevel == null ? "capped" : `capped at ${r.capLevel}`;
  const cap = r.capped ? `, ${capAt} by ${breachNames(r.breaches)}` : "";
  const dims = DIMENSIONS.map((d, i) => `${d.label} ${r.dims[i] == null ? "not measured" : Math.round(r.dims[i] as number)}`).join(", ");
  const tail = `${int(r.records)} records checked, ${int(r.rules)} rules measured, coverage ${pct1(r.coverage)}${r.lowConfidence ? ", low confidence" : ""}.`;
  return `${r.label}: measured ${f1(r.measured)}, shown ${f1(r.score)}${cap}. ${dims}. ${tail}`;
}

/** The sentence under the big score: what caps it, in words, or that nothing does. */
export function capSentence(capped: boolean, capLevel: number | null, breaches: readonly string[]): string {
  if (!capped) return breaches.length === 0 ? "No critical rule is over tolerance, so nothing caps this score." : "A critical rule is over tolerance, but the score is already below its cap.";
  const n = breaches.length;
  if (n === 1) return `Capped at ${capLevel} by ${breaches[0]}, one critical rule over tolerance.`;
  if (n === 2) return `Capped at ${capLevel} by ${breaches[0]} and ${breaches[1]}, two critical rules over tolerance.`;
  return `Capped at ${capLevel} by ${n} critical rules over tolerance, among them ${breaches[0]} and ${breaches[1]}.`;
}

/** URL segment for a module id: material_master becomes material-master. */
export const moduleSlug = (module: string): string => module.replace(/_/g, "-");
/** The API's module id for a URL segment. */
export const moduleFromSlug = (slug: string): string => slug.replace(/-/g, "_");

/** URL segment for a system: its name in lower case with hyphens (ECC production becomes ecc-production). */
export function systemSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Finds a system by the URL segment: its slug, its id, or its name in any case. */
export function findSystem<T extends { id: string; name: string }>(systems: readonly T[], segment: string): T | undefined {
  const s = segment.toLowerCase();
  return systems.find((x) => systemSlug(x.name) === s || x.id.toLowerCase() === s || x.name.toLowerCase() === s);
}
