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
import type { BatchCreated, BatchFilter } from "@/lib/api/remediation";
import { v2Get, v2Send } from "./client";

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

/**
 * What Aletheia found (GET /insights/findings): ranked deterministic findings over the current state, what changed
 * since each object's previous run, and the proof of value of every finding a person acted on.
 */
/** tune drafts the tuned rule version; merge opens the object's match & merge review (``pairs`` waiting); assign sets
 *  the rule's owner in data_owners; cleanse drafts a cleansing batch; open opens the rule. */
export type AletheiaActionKind = "tune" | "cleanse" | "open" | "merge" | "assign" | "across";

/** Open duplicate pairs between two connected systems (match_scores with explanation.sources), as the sources name them. */
export interface AcrossSystemsCount {
  a: string;
  b: string;
  pairs: number;
}

export interface AletheiaFinding {
  id: string;
  module: string;
  version_id: string;
  check_id: string;
  name: string;
  field: string | null;
  severity: string | null;
  dimension: string | null;
  affected: number;
  total: number | null;
  impact: number;
  delta_affected: number | null;
  auto_fix_pct: number | null;
  spark: (number | null)[];
  why: { origin: { status: string; top: string | null; share: number | null }; delta_affected: number | null };
  money: { cost_at_risk: number | null; currency: string; features: { feature: string; l1: string | null; value_at_risk: number | null }[] };
  confidence: { basis: "precision" | "origin_share"; value: number } | null;
  /** across: the object has duplicates in more than one connected system; ``pairs`` counts them, ``systems`` splits them per system pair. */
  action: { kind: AletheiaActionKind; pairs?: number; systems?: AcrossSystemsCount[] };
}

export interface AletheiaChange {
  module: string;
  version_id: string;
  previous_version_id: string | null;
  score: number | null;
  previous: number | null;
  delta: number | null;
  movers: { check_id: string; name: string; delta_affected: number }[];
}

export interface AletheiaActed {
  module: string;
  check_id: string;
  /** The rule's text when the current run still has it; null otherwise. */
  name: string | null;
  action: AletheiaActionKind;
  version_id: string;
  affected_before: number | null;
  score_before: number | null;
  created_at: string | null;
  waiting: boolean;
  affected_now: number | null;
  score_now: number | null;
  reduction: number | null;
  gain: number | null;
  proven_cost: { metric: string; label: string | null; before: number | null; after: number | null }[] | null;
  currency: string;
}

export interface AletheiaFound {
  currency: string;
  findings: AletheiaFinding[];
  changes: AletheiaChange[];
  acted: AletheiaActed[];
}

export interface ActedBaseline {
  module: string;
  check_id: string;
  action: AletheiaActionKind;
  version_id: string;
  score_before: number | null;
  affected_before: number | null;
}

export const getFindings = (module?: string) => v2Get<AletheiaFound>(`${P}/findings`, { module });
/** Records that a person acted on a finding; the server stores the run, score and failing records as the baseline. */
export const markActed = (body: { module: string; check_id: string; action: AletheiaActionKind }) =>
  v2Send<ActedBaseline>("POST", `${P}/findings/acted`, body);
/** A cleansing batch over one rule's open issues (POST /remediation/batches), drafted for approval. */
export const createRuleBatch = (name: string, filter: Pick<BatchFilter, "module" | "check_id">) =>
  v2Send<BatchCreated>("POST", "/remediation/batches", { name, filter });
