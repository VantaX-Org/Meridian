/** Pure helpers for the system comparison screens (design/v2/screens/Compare*.tsx). */
import type { TrendPointRow } from "@/lib/api/v2/compare";

export type ScoreSide = "source" | "projected" | "actual";
export const SIDES: readonly ScoreSide[] = ["source", "projected", "actual"];

/** A record key as the backend writes it, "MATNR=100|WERKS=1000", split into its fields. */
export function keyParts(key: string): { field: string; value: string }[] {
  return key.split("|").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? { field: "", value: p } : { field: p.slice(0, i), value: p.slice(i + 1) };
  });
}

/** The trend as one series per score, oldest first. */
export function trendSeries(points: readonly TrendPointRow[]): Record<ScoreSide, (number | null)[]> {
  const sorted = [...points].sort((a, b) => a.at.localeCompare(b.at));
  return { source: sorted.map((p) => p.source), projected: sorted.map((p) => p.projected), actual: sorted.map((p) => p.actual) };
}

/** Points the target falls short of the projection; null when either is missing. */
export function shortfall(projected: number | null, actual: number | null): number | null {
  return projected == null || actual == null ? null : Math.round((projected - actual) * 10) / 10;
}
