// The executive summary's Fix first: what to fix first, ranked by impact. Pure; no fetching.

/**
 * Severity weights for ranking, the same scale the owner scorecard scores open issues with
 * (api/services/insights_owners.py `_SEVERITY_WEIGHT`): a critical failing record weighs ten low ones.
 */
export const SEVERITY_WEIGHT: Record<string, number> = { critical: 10, high: 5, medium: 2, low: 1 };

export interface FixFirstInput {
  severity: string | null;
  /** Failing records of the rule. */
  records: number;
  /** Failing records times their cost per record, when the cost model priced them. */
  cost: number | null | undefined;
}

/** A rule's impact: its failing records times its severity weight. */
export const impactOf = (r: FixFirstInput): number => r.records * (SEVERITY_WEIGHT[(r.severity ?? "").toLowerCase()] ?? 1);

/**
 * Fix first: low-severity rules left out, the rest by impact (failing records x severity weight), then by cost at
 * risk, then by records; at most `limit`.
 */
export function rankFixFirst<T>(rows: readonly T[], pick: (row: T) => FixFirstInput, limit: number): T[] {
  return rows
    .filter((r) => (pick(r).severity ?? "").toLowerCase() !== "low")
    .map((r) => ({ r, k: pick(r) }))
    .sort((a, b) => impactOf(b.k) - impactOf(a.k) || (b.k.cost ?? 0) - (a.k.cost ?? 0) || b.k.records - a.k.records)
    .slice(0, limit)
    .map(({ r }) => r);
}
