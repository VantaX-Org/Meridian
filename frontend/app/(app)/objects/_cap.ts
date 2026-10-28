import type { ObjectSummary } from "@/lib/api/v1/objects";

/** The caps the score applies (api/services/scoring.py `_cap`): one critical failure holds it at 85, two or more at 70. */
const CAPS = [70, 85];

/** What a score cell draws: the figure (the measured score before the cap when known) and the cap tick, when one holds it down. */
export interface CappedScore {
  shown: number;
  cap?: number;
}

/**
 * The score of an objects-list row. A capped object shows its uncapped score with the cap as a tick, so objects that
 * all sit at the cap still rank against each other. A backend that does not say (`capped` and `raw_score` absent)
 * is read from the row itself: a critical failing rule and a score exactly at a cap value means it is capped, with
 * no uncapped figure to show.
 */
export function cappedScore(o: Pick<ObjectSummary, "composite_score" | "raw_score" | "capped" | "critical_checks">): CappedScore | null {
  const score = o.composite_score;
  if (score == null) return null;
  if (o.capped) return { shown: o.raw_score != null && o.raw_score > score ? o.raw_score : score, cap: score };
  if (o.capped === undefined && o.raw_score == null && (o.critical_checks ?? 0) > 0 && CAPS.includes(score)) return { shown: score, cap: score };
  return { shown: score };
}
