import libraryJson from "./library.json";
import type { DimensionKey, RuleRow } from "../types";

/** One shipped rule of the demo tenant's run, as scripts/fixture-rules.py takes it from checks/rules (id, message, field, severity, dimension, class) with its result. */
export interface LibraryRule {
  check_id: string;
  module: string;
  name: string;
  field: string | null;
  severity: "critical" | "high" | "medium" | "low";
  dimension: DimensionKey;
  check_class: string;
  failing: number;
  total: number;
}

export const LIBRARY = (libraryJson as unknown as { rules: LibraryRule[] }).rules;

/** The rules of one object that fail in the fixture run, as GET /findings lists them, worst first. */
export function failingRulesOf(module: string): RuleRow[] {
  const sev = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return LIBRARY.filter((r) => r.module === module && r.failing > 0)
    .sort((a, b) => sev[a.severity] - sev[b.severity] || b.failing - a.failing)
    .map((r) => ({ check_id: r.check_id, name: r.name, field: r.field, severity: r.severity, affected_count: r.failing, total_count: r.total, pass_rate: Math.round((1 - r.failing / r.total) * 10000) / 100, value_at_risk: null, dimension: r.dimension, check_class: r.check_class }));
}
