/**
 * Rule impact dry run client (api/routes/rule_impact.py). Needs `manage_rules`.
 *
 *   POST /rules/impact-dry-run   run an existing (maybe switched-off) rule, or a draft, read-only on the latest stored
 *                                extraction: records failing, projected score, failing values by shape, and for an
 *                                edit the records newly failing and newly passing against the current rule.
 *
 * Reads the stored extraction only: never SAP, nothing written to findings. Shapes are counts, never field values.
 */
import { v2Send } from "./client";

export interface ImpactRequest {
  module: string;
  rule_id?: string;
  /** With rule_id: the fields to change. Without: a whole draft rule. */
  rule?: Record<string, unknown>;
  row_cap?: number;
}

export interface ImpactResult {
  module: string;
  run_id: string;
  rule_id: string;
  mode: "new" | "edit";
  rule: { field: string | null; field_text: string; message: string | null; check_class: string | null; severity: string | null; dimension: string | null };
  evaluated: boolean;
  reason: string | null;
  row_cap: { cap: number; sampled: boolean; tables_cut: Record<string, number>; note: string };
  sample?: { records_evaluated: number; records_failing: number };
  records_evaluated?: number;
  records_failing?: number;
  failure_rate?: number;
  failing_shapes?: { shape: string; count: number }[];
  dqs?: { before: number; after: number; delta: number; breaches_before: number; breaches_after: number };
  delta?: { current_failing: number; newly_failing: number; newly_passing: number; unchanged_failing: number; basis: string };
}

export const runImpactDryRun = (body: ImpactRequest): Promise<ImpactResult> => v2Send("POST", "/rules/impact-dry-run", body);
