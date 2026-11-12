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

/** GET /insights/overview: the headline of a run. Only the fields the page reads are typed. */
export interface InsightOverview {
  version_id: string | null;
  run_label: string | null;
  run_at: string | null;
  dqs: { composite: number | null; previous: number | null; delta: number | null; tier: string | null; capped: boolean; cap_reason: string | null } | null;
  blockers: { count: number; previous: number | null } | null;
  auto_fixable: { records: number; failing_records: number; pct: number | null; high_confidence: number } | null;
  value_at_risk: { worst_l1: string | null; worst_l1_amount: number | null; currency: string | null; features_blocked: number } | null;
  narrative: string | null;
}
export const getOverview = () => v2Get<InsightOverview>(`${P}/overview`, current);

/** GET /insights/exec: the executive read. A day-one tenant gets empty fields. */
export interface InsightExec {
  version_id: string | null;
  composite: number | null;
  cap: number | null;
  cap_reason: string | null;
  narrative: string | null;
  waterfall: { x: string; y: number; l1: string | null }[];
}
export const getExec = () => v2Get<InsightExec>(`${P}/exec`, current);

/** GET /insights/cleansing: the pipeline from failing records to applied fixes. */
export interface Cleansing {
  version_id: string | null;
  currency: string | null;
  steps: { key: string; label: string; records: number }[];
  by_module: { module: string; failing: number; proposed: number; high: number }[];
  by_rule: { check_id: string; proposed: number; high: number; auto: number }[];
}
export const getCleansing = () => v2Get<Cleansing>(`${P}/cleansing`, current);

/** GET /insights/owners: each owner's score, open items and the digest they get. */
export interface OwnerRow {
  owner: string;
  score: number | null;
  delta: number | null;
  open_by_severity: Record<string, number>;
  fixed_since_baseline: number | null;
  oldest_item_age_days: number | null;
  digest: string | null;
  user_id: string | null;
  schedule: string | null;
  last_sent: string | null;
}
export const getOwners = () => v2Get<{ owners: OwnerRow[] }>(`${P}/owners`);

/** GET /insights/duplicates/{object}/{record_id}: record_id is the golden record's id. */
export interface DuplicateCluster {
  nodes: { id: string; size: number; label: string }[];
  edges: { source: string; target: string; label: string }[];
  thresholds: { auto_merge: number; review_floor: number };
}
export const getDuplicateCluster = (object: string, recordId: string) =>
  v2Get<DuplicateCluster>(`${P}/duplicates/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`);
