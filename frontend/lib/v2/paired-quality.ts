import type { ReconReason, ReconScores } from "@/lib/api/v2/migration";

/** One object's source, projected and actual target score, with the rules that explain the gap, largest first. */
export interface PairedRow {
  module: string;
  source: number | null;
  projected: number | null;
  actual: number | null;
  actualReason: ReconScores["actual_reason"];
  /** Actual minus source, in points; null unless both exist. Never estimated. */
  moved: number | null;
  reasons: ReconReason[];
}

/** Pairs every object's scores from a reconciliation and orders its reasons by the size of the change. */
export function pairQuality(scores: readonly ReconScores[], maxReasons = 3): PairedRow[] {
  return scores.map((s) => ({
    module: s.module,
    source: s.source,
    projected: s.projected,
    actual: s.actual,
    actualReason: s.actual_reason,
    moved: s.actual != null && s.source != null ? Math.round((s.actual - s.source) * 10) / 10 : null,
    reasons: [...s.reasons].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, maxReasons),
  }));
}
