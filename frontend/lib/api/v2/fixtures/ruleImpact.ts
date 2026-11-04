/**
 * Rule impact dry run fixture, shaped like api/routes/rule_impact.py. Synthetic vendor-number rule on a small extraction;
 * the numbers are made up and no value names a person. A request with `rule` changes reports a delta (an edit).
 */
import type { ImpactRequest, ImpactResult } from "../rule-impact";

export const NONE_RULE_IMPACT = Symbol("not a rule impact path");

const refuse = (status: number, detail: unknown): never => {
  throw Object.assign(new Error(String(detail)), { status, response: { status, data: { detail } } });
};

const RULE = { field: "LFA1.LIFNR", field_text: "Account number of vendor or creditor", message: "Vendor number must be alphanumeric, at most 10 characters", check_class: "regex_check", severity: "high", dimension: "validity" };

export function ruleImpactWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/rules/impact-dry-run") return NONE_RULE_IMPACT;
  const b = (body ?? {}) as ImpactRequest;
  if (!b.rule_id && !b.rule) return refuse(422, "Name a rule_id or give a draft rule");
  if (b.rule_id === "NOPE") return refuse(404, "Unknown rule");
  const edit = !!b.rule_id;
  const stricter = !!b.rule && Object.keys(b.rule).length > 0;
  const cap = b.row_cap ?? 50000;
  const failing = stricter ? 4120 : 3180;
  const total = 120000;
  const out: ImpactResult = {
    module: b.module, run_id: "run-fixture-1", rule_id: b.rule_id ?? String((b.rule as { id?: string }).id ?? "NEW"), mode: edit ? "edit" : "new",
    rule: RULE, evaluated: true, reason: null,
    row_cap: { cap, sampled: cap < total, tables_cut: cap < total ? { LFA1: total } : {}, note: "first rows of each table; counts are scaled to the full table" },
    sample: { records_evaluated: Math.min(cap, total), records_failing: Math.round(failing * Math.min(cap, total) / total) },
    records_evaluated: total, records_failing: failing, failure_rate: Math.round((failing / total) * 10000) / 100,
    failing_shapes: [{ shape: "aaa", count: 1480 }, { shape: "AAA999", count: 960 }, { shape: "99-99", count: 420 }, { shape: "blank", count: 320 }],
    dqs: { before: 91.4, after: stricter ? 89.1 : 90.2, delta: stricter ? -2.3 : -1.2, breaches_before: 1, breaches_after: 1 },
  };
  if (edit) out.delta = { current_failing: 3180, newly_failing: stricter ? 960 : 0, newly_passing: stricter ? 20 : 0, unchanged_failing: 3160, basis: "failing record keys in the evaluated rows" };
  return out;
}
