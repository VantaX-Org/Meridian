/** Pure helpers for the match review: score bands in words, why a pair matched, and per-field survivor picks. */

import type { AttributeExplanation, MatchExplanation } from "@/lib/api/merge-explain";
import type { ScoreBand } from "@/lib/api/match-review";

export const BAND_LABEL: Record<ScoreBand, string> = {
  review: "Uncertain",
  auto_merge: "Likely duplicates",
  low: "Low score",
};

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export const blank = (v: unknown) => v == null || v === "";
export const show = (v: unknown) => (blank(v) ? "" : String(v));

export type AttributeVerdict = "matched" | "differs" | "skipped";

/** An attribute matched when it met its threshold (or, with none recorded, scored 85% or more). */
export function attributeVerdict(a: AttributeExplanation): AttributeVerdict {
  if (a.skipped) return "skipped";
  if (a.threshold_met != null) return a.threshold_met ? "matched" : "differs";
  return (a.similarity ?? 0) >= 0.85 ? "matched" : "differs";
}

/** "Matched on NAME_ORG1 and CITY, differs on TAXNUM": the pair's reason in one line, strongest fields first. */
export function whyMatched(e: MatchExplanation | null | undefined): string {
  const attrs = [...(e?.attributes ?? [])].sort((x, y) => y.contribution - x.contribution);
  if (!attrs.length) return "No field comparison was recorded";
  const by = (v: AttributeVerdict) => attrs.filter((a) => attributeVerdict(a) === v).map((a) => a.field);
  const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);
  const matched = by("matched");
  const differs = by("differs");
  const parts = [matched.length ? `Matched on ${list(matched)}` : "No field matched", differs.length ? `differs on ${list(differs)}` : ""];
  return parts.filter(Boolean).join(", ");
}

export type Side = "a" | "b";
export type Picks = Record<string, Side>;

/** Every field either record carries, in a stable order. */
export function pairFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
}

/** The merge's own choice per field: the surviving record's value, or the other's when the survivor's is blank. */
export function defaultPicks(a: Record<string, unknown>, b: Record<string, unknown>, survivor: Side): Picks {
  const out: Picks = {};
  for (const f of pairFields(a, b)) {
    const [mine, theirs] = survivor === "a" ? [a[f], b[f]] : [b[f], a[f]];
    const other: Side = survivor === "a" ? "b" : "a";
    out[f] = blank(mine) && !blank(theirs) ? other : survivor;
  }
  return out;
}

/** The side each field's value came from in a merge preview (its survivorship winner); `fallback` where unknown. */
export function winnerPicks(
  survivorship: Record<string, { winner_key: string | null }> | undefined, aKey: string, bKey: string, fallback: Picks,
): Picks {
  const out: Picks = { ...fallback };
  for (const [f, ex] of Object.entries(survivorship ?? {})) {
    if (ex.winner_key === aKey) out[f] = "a";
    else if (ex.winner_key === bKey) out[f] = "b";
  }
  return out;
}

/** The fields the steward picked differently from the merge's own choice (`base`), as overrides the API stores. */
export function overridesFromPicks(
  picks: Picks, base: Picks, a: Record<string, unknown>, b: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, side] of Object.entries(picks)) if (base[f] !== side) out[f] = show(side === "a" ? a[f] : b[f]);
  return out;
}
