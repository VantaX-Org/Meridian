import type { Row } from "@tanstack/react-table";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, pass: 4 };

/** Rank of a severity word, worst first; unknown or empty values sort last. */
export const severityRank = (v: unknown): number => RANK[String(v ?? "")] ?? 5;

/** Column sortingFn for severity-word accessors: ascending is worst first. */
export const bySeverity = <T,>(a: Row<T>, b: Row<T>, columnId: string): number =>
  severityRank(a.getValue(columnId)) - severityRank(b.getValue(columnId));
