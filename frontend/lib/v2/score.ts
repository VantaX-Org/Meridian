/**
 * Score maths and wording for the Meridian 2 ruler, shared by the map, the matrix and the object canvas.
 * Pure functions only: geometry is computed here so it can be tested without a DOM.
 */
import { DIMENSIONS, type DimensionKey, type Verdict } from "@/lib/api/v2/types";
import { fixed, v2Locale } from "./format";
import { t } from "@/lib/v2/i18n";

export const DASH = "—";

/** One decimal, or a dash for a value the API did not store. */
export function f1(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? DASH : fixed(Math.round(n * 10) / 10, 1);
}

/** Whole number with thousands separators in the chosen locale (en-US until one is chosen), or a dash. */
export function int(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? DASH : Math.round(n).toLocaleString(v2Locale());
}

/** A 0 to 1 share as a percentage with one decimal ("97.4%"), or a dash. */
export function pct1(share: number | null | undefined): string {
  return share == null || Number.isNaN(share) ? DASH : `${fixed(Math.round(share * 1000) / 10, 1)}%`;
}

export const VERDICT_LABEL: Record<Verdict, string> = { get "no-go"() { return t("No-go"); }, get "at-risk"() { return t("At risk"); }, get go() { return t("Go"); } };

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
  axis: { y: number; value: number; label: string; kind: "scale" | "band"; title?: string }[];
  caps: { y: number; value: number; label: string; title?: string }[];
  /** Every text of the 240 drawing as a box, in drawing units, laid out so no two overlap (rulerLabelBoxes). */
  labels: RulerLabelBox[];
}

/** One label of the ruler as a box: the text, where it sits and how much room it takes. */
export interface RulerLabelBox {
  kind: "scale" | "band" | "cap" | "dimension" | "score";
  text: string;
  /** The full words behind a short label, for the hover title. */
  title: string;
  /** Left edge, top edge, width and height of the box. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Line height of a 12 px label and the room kept between two labels. */
export const LABEL_H = 14;
const LABEL_GAP = 2;

/** The width of a 12 px label: Plex Sans figures and Latin letters are about 6.6 px, CJK characters a full 12 px. */
export function labelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 12 : 6.6;
  return Math.ceil(w);
}

/** The short name of each dimension under its segment (the letters of the formula); the full name is the title. */
export function dimensionShort(key: DimensionKey): string {
  switch (key) {
    case "completeness": return t("Completeness (short)");
    case "accuracy": return t("Accuracy (short)");
    case "consistency": return t("Consistency (short)");
    case "timeliness": return t("Timeliness (short)");
    case "uniqueness": return t("Uniqueness (short)");
    default: return t("Validity (short)");
  }
}

/** Moves labels of one column apart so none overlaps the next, keeping their order and staying nearest their marks. */
export function spreadLabels<T extends { y: number; height: number }>(labels: T[]): T[] {
  const out = [...labels].sort((a, b) => a.y - b.y).map((l) => ({ ...l }));
  for (let i = 1; i < out.length; i++) {
    const min = out[i - 1].y + out[i - 1].height + LABEL_GAP;
    if (out[i].y < min) out[i].y = min;
  }
  return out;
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
export function rulerGeometry(size: RulerSize, dims: ReadonlyArray<number | null>, measured: number | null, opts: { compact?: boolean; available?: number } = {}): RulerGeometry {
  const large = size === 240;
  const compact = large && opts.compact === true;
  const top = large ? LARGE.top : 0;
  const height = large ? LARGE.height : SMALL.height;
  // The 240 ruler's gutters fit its own words (German and Japanese run longer than English); on a phone the band
  // and cap labels are the short forms and the plot takes the width that is left.
  const bandText = (v: number, word: string) => (compact ? String(v) : word);
  const bands = large ? [{ v: 60, word: t("60 critical") }, { v: 75, word: t("75 at risk") }, { v: 90, word: t("90 go") }] : [];
  // On a phone the cap lines carry their level ("85", "70") and the words are the title.
  const capDefs = large ? [{ v: 85, word: t("cap 1 critical"), short: "85" }, { v: 70, word: t("cap 2 or more"), short: "70" }] : [];
  const leftW = large ? Math.max(labelWidth("50"), ...bands.map((b) => labelWidth(bandText(b.v, b.word)))) : 0;
  const rightW = large ? Math.max(...capDefs.map((c) => labelWidth(compact ? c.short : c.word))) : 0;
  const left = large ? Math.max(compact ? 0 : LARGE.left, leftW + 14 + 2) : 0;
  const right = large ? Math.max(compact ? 0 : LARGE.right, rightW + 14 + 2) : 0;
  const plotW = large ? (compact ? Math.max(160, Math.min(LARGE.width, (opts.available ?? 288) - left - right)) : LARGE.width) : size;
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
  const labels: RulerLabelBox[] = [];
  const bottom = top + height;
  if (large) {
    // The band words on the left, spread so none touches the next; a scale number keeps its tick but not its text
    // where a band word sits.
    const leftLabels = spreadLabels(bands.map((b) => ({ value: b.v, text: bandText(b.v, b.word), title: b.word, y: scoreY(b.v, top, height) - LABEL_H / 2, height: LABEL_H })));
    for (const l of [...leftLabels].sort((a, b) => a.value - b.value)) axis.push({ y: l.y + LABEL_H / 2, value: l.value, label: l.text, kind: "band", title: l.title });
    for (const v of [0, 25, 50, 100]) {
      const y = scoreY(v, top, height);
      const clear = leftLabels.every((l) => y + LABEL_H / 2 + LABEL_GAP <= l.y || y - LABEL_H / 2 - LABEL_GAP >= l.y + l.height);
      axis.push({ y, value: v, label: clear ? String(v) : "", kind: "scale" });
    }
    const rightLabels = spreadLabels(capDefs.map((c) => ({ value: c.v, text: compact ? c.short : c.word, title: c.word, y: scoreY(c.v, top, height) - LABEL_H / 2, height: LABEL_H })));
    for (const c of [...rightLabels].sort((a, b) => b.value - a.value)) caps.push({ y: scoreY(c.value, top, height), value: c.value, label: c.text, title: c.title });
    for (const a of axis) if (a.label) labels.push({ kind: a.kind, text: a.label, title: a.title ?? a.label, x: left - 14 - labelWidth(a.label), y: a.y - LABEL_H / 2, width: labelWidth(a.label), height: LABEL_H });
    for (const c of rightLabels) labels.push({ kind: "cap", text: c.text, title: c.title, x: left + plotW + 14, y: c.y, width: labelWidth(c.text), height: LABEL_H });
    // Under each segment: its short name, then its score.
    for (const sg of segments) {
      const short = dimensionShort(sg.key);
      const num = sg.score == null ? DASH : String(Math.round(sg.score));
      const cx = sg.x + sg.width / 2;
      labels.push({ kind: "dimension", text: short, title: sg.label, x: cx - labelWidth(short) / 2, y: bottom + 6, width: labelWidth(short), height: LABEL_H });
      labels.push({ kind: "score", text: num, title: `${sg.label} ${num}`, x: cx - labelWidth(num) / 2, y: bottom + 6 + LABEL_H, width: labelWidth(num), height: LABEL_H });
    }
  }
  return {
    size,
    viewWidth: large ? left + plotW + right : plotW,
    viewHeight: top + height + (large ? 6 + 2 * LABEL_H + 4 : 0),
    plot: { left, top, width: plotW, height },
    gap,
    segments,
    tickY,
    axis,
    caps,
    labels,
  };
}

/** True when two label boxes share any point. */
export function labelsOverlap(a: RulerLabelBox, b: RulerLabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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

/** Names the capping rules: "MM003 and MM035", or the count when there are more than two. */
export function breachNames(breaches: readonly string[]): string {
  if (breaches.length === 0) return "";
  if (breaches.length <= 2) return breaches.join(t(" and "));
  return t("{breachesCount} failing critical rules", { breachesCount: breaches.length });
}

/** The full reading of a score, the text of the ruler's title and accessible name. */
export function readingText(r: Reading): string {
  const cap = r.capped ? t(", held down from {measured} because {breachNames} fail", { measured: f1(r.measured), breachNames: breachNames(r.breaches) }) : "";
  const dims = DIMENSIONS.map((d, i) => `${d.label} ${r.dims[i] == null ? t("not measured") : Math.round(r.dims[i] as number)}`).join(", ");
  const tail = t("Based on {records} records and {rules} rules, covering {pct1} of the data{value}.", { records: int(r.records), rules: int(r.rules), pct1: pct1(r.coverage), value: r.lowConfidence ? t(", so treat it with care") : "" });
  return t("{label} scores {score}{cap}. {dims}. {tail}", { label: r.label, score: f1(r.score), cap, dims, tail });
}

/** The sentence under the big score: what caps it, in words, or that nothing does. */
export function capSentence(capped: boolean, capLevel: number | null, breaches: readonly string[]): string {
  if (!capped) return breaches.length === 0 ? t("No critical rule is failing, so nothing holds this score down.") : t("A critical rule is failing, but the score is already below the limit it sets.");
  const n = breaches.length;
  if (n === 1) return t("Held at {capLevel} because one critical rule fails: {breaches}.", { capLevel, breaches: breaches[0] });
  if (n === 2) return t("Held at {capLevel} because two critical rules fail: {breaches} and {breaches2}.", { capLevel, breaches: breaches[0], breaches2: breaches[1] });
  return t("Held at {capLevel} because {n} critical rules fail, including {breaches} and {breaches2}.", { capLevel, n, breaches: breaches[0], breaches2: breaches[1] });
}

/** URL segment for a module id: material_master becomes material-master. */
export const moduleSlug = (module: string): string => module.replace(/_/g, "-");
/** The API's module id for a URL segment. */
export const moduleFromSlug = (slug: string): string => slug.replace(/-/g, "_");

/** URL segment for a system: its name in lower case with hyphens (ECC production becomes ecc-production). */
export function systemSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The system segment of an address that names an object but not its system (`/o/_/material-master`): the redirects
 * from the old object pages use it, and the object canvas replaces it with the system that holds the object. No system
 * slug can be "_" (a slug is lower-case letters, digits and hyphens).
 */
export const ANY_SYSTEM = "_";

/** The system that holds an object: the one with the most records checked for it, else the first that lists it. */
export function systemForModule<S extends { id: string }, C extends { system_id: string; module: string; records_checked?: number | null }>(systems: readonly S[], cells: readonly C[], module: string): S | undefined {
  const held = cells.filter((c) => c.module === module).sort((a, b) => (b.records_checked ?? 0) - (a.records_checked ?? 0));
  for (const c of held) {
    const s = systems.find((x) => x.id === c.system_id);
    if (s) return s;
  }
  return undefined;
}

/** Finds a system by the URL segment: its slug, its id, or its name in any case. */
export function findSystem<T extends { id: string; name: string }>(systems: readonly T[], segment: string): T | undefined {
  const s = segment.toLowerCase();
  return systems.find((x) => systemSlug(x.name) === s || x.id.toLowerCase() === s || x.name.toLowerCase() === s);
}

/**
 * Lowest measured score first: the order of the landscape and the map. The measured score (before any cap) ranks
 * objects the cap would tie at 70.0; an object with no score goes last, and ties keep the object's name order.
 */
export function byMeasured<T extends { raw_score: number | null; score: number | null; module: string }>(cells: readonly T[]): T[] {
  const m = (c: T) => c.raw_score ?? c.score ?? Number.POSITIVE_INFINITY;
  return [...cells].sort((a, b) => m(a) - m(b) || a.module.localeCompare(b.module));
}
