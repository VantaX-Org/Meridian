/**
 * Cost and causes client (api/routes/insights.py): what bad data costs, per business area, and where it comes from.
 *
 *   GET /insights/impact?scope=current       (priced SAP features the current state blocks or degrades)
 *   GET /insights/proven-cost?scope=current  (money already lost in posted documents, per metric and L1)
 *   GET /insights/root-causes?scope=current  (failing rules grouped by the field they fail on)
 *   GET /insights/trends                     (the score and rule movement run by run)
 *
 * Costs and value at risk are grouped per L1 only; the backend never adds them across L1s and neither does the page.
 */
import { v2Get } from "./client";

const P = "/insights";

export interface ImpactRow {
  feature: string;
  l1: string | null;
  status: string;
  record_count: number;
  value_per_record: number;
  value_at_risk: number;
  /** blocking_findings: check ids, or objects carrying a check_id. */
  causing_rules: unknown[];
}

export interface ProvenCostRow {
  metric: string;
  label: string;
  amount: number;
  /** Null when the metric spans more than one currency; by_currency then carries the split. */
  currency: string | null;
  by_currency: Record<string, number> | null;
  documents: number | null;
  check_ids: string[];
  l1: string;
}

export interface ProvenCost {
  currency: string | null;
  rows: ProvenCostRow[];
  cost_by_l1: { l1: string; amount: number }[];
  value_at_risk_by_l1: { l1: string; value_at_risk: number }[];
}

export interface CauseCluster {
  key: string;
  kind: "field" | "unattributed";
  module: string;
  table: string | null;
  field: string | null;
  rules: string[];
  dimension: string | null;
  severity: string | null;
  records: number;
  records_estimated: boolean;
  auto_fix_pct: number | null;
  origin?: { status: "computed" | "not_computed"; top: string | null; share: number | null };
}

export interface TrendRun {
  version_id: string;
  label: string | null;
  run_at: string | null;
  composite: number | null;
  failing_rules: number;
  affected_records: number;
  change: number | null;
  rules_fixed: number | null;
  rules_new: number | null;
}

const current = { scope: "current" };

export const getImpact = () => v2Get<{ rows: ImpactRow[] }>(`${P}/impact`, current);
export const getProvenCost = () => v2Get<ProvenCost>(`${P}/proven-cost`, current);
export const getCauseClusters = () => v2Get<{ clusters: CauseCluster[] }>(`${P}/root-causes`, current);
export const getTrends = () => v2Get<{ runs: TrendRun[] }>(`${P}/trends`, { limit: 12 });
