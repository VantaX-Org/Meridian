import apiClient from "./client";
import type { ChartPoint, GraphEdge, GraphNode } from "@/design";

/* ─── Readiness (spec 8.1) ─── */

export interface ReadinessCell {
  module: string;
  wave: string;
  verdict: "go" | "at_risk" | "no_go";
  /** Blocking gaps (every gap type except unmapped_field and target_config_unverified). */
  blocker_count: number;
  dqs: number | null;
  /** Transfer readiness %, from the wave's latest migration run. */
  score: number | null;
  records_blocked: number;
}

export interface ReadinessResponse {
  version_id: string | null;
  threshold: number;
  cells: ReadinessCell[];
  /** False when the tenant has not set readiness_waves under Settings > Alert Thresholds. */
  configured: boolean;
}

export async function getReadiness(params?: { version_id?: string }): Promise<ReadinessResponse> {
  const { data } = await apiClient.get<ReadinessResponse>("/api/v1/insights/readiness", { params });
  return data;
}

/* ─── Impact / value-at-risk (spec 8.2) ─── */

export interface ImpactRow {
  feature: string;
  l1?: string | null;
  status: string;
  record_count: number;
  value_per_record: number;
  value_at_risk: number;
  causing_rules: string[];
}

export interface ImpactResponse {
  version_id: string | null;
  rows: ImpactRow[];
}

/** One run (`version_id`, default the latest with impact rows), or `scope: "current"`: every object at its latest run, each feature from the newest run that computed it. */
export async function getImpact(params?: { version_id?: string; scope?: "current" }): Promise<ImpactResponse> {
  const { data } = await apiClient.get<ImpactResponse>("/api/v1/insights/impact", { params });
  return data;
}

/* ─── Proven cost (S4 load dry run + transaction cost) ─── */

export type ProvenCostMetric = "late_po" | "grir_uom_variance" | "blocked_sales" | "duplicate_payment";

export interface ProvenCostItem {
  doc_key: string;
  master_key: string;
  amount: number;
  detail: string;
  check_ids: string[];
}

export interface ProvenCostRow {
  metric: ProvenCostMetric;
  l1: string;
  label: string;
  amount: number;
  currency: string | null;
  by_currency: Record<string, number>;
  documents: number;
  check_ids: string[];
  items: ProvenCostItem[];
}

export interface ValueAtRiskL1 {
  l1: string;
  value_at_risk: number;
}

export interface CostL1 {
  l1: string;
  amount: number;
}

export interface ProvenCostResponse {
  version_id: string | null;
  currency: string | null;
  rows: ProvenCostRow[];
  /** Proven cost per L1 in the tenant currency. There is no total across L1s. */
  cost_by_l1: CostL1[];
  /** Per-L1 only. Value at risk is never summed across L1s. */
  value_at_risk_by_l1: ValueAtRiskL1[];
}

const L1_LABELS: Record<string, string> = {
  procure_to_pay: "Procure to pay",
  order_to_cash: "Order to cash",
  plan_to_produce: "Plan to produce",
  record_to_report: "Record to report",
  hire_to_retire: "Hire to retire",
  master_data: "Master data",
  unassigned: "Unassigned",
};

/** Display label for a backend L1 key; unknown keys fall back to a spaced, capitalised form. */
export function l1Label(key: string): string {
  if (L1_LABELS[key]) return L1_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Group impact rows by L1 (value at risk summed within an L1 only). Rows with no L1 group as "unassigned". */
export function valueAtRiskByL1(rows: ImpactRow[]): ValueAtRiskL1[] {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.l1 || "unassigned", (out.get(r.l1 || "unassigned") ?? 0) + r.value_at_risk);
  return [...out].map(([l1, value_at_risk]) => ({ l1, value_at_risk }));
}

/** Largest L1 by value at risk, plus how many processes (L1s) the figure sits among. Never a sum. */
export function largestValueAtRisk(by_l1: ValueAtRiskL1[]): { l1: string; value_at_risk: number; processes: number } | null {
  if (by_l1.length === 0) return null;
  const top = by_l1.reduce((a, b) => (b.value_at_risk > a.value_at_risk ? b : a));
  return { ...top, processes: by_l1.length };
}

/** Largest L1 by proven cost, plus how many processes (L1s) it sits among. Never a sum. */
export function largestCost(by_l1: CostL1[]): { l1: string; amount: number; processes: number } | null {
  if (by_l1.length === 0) return null;
  const top = by_l1.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { ...top, processes: by_l1.length };
}

/** One run, or `scope: "current"`: each metric from the newest current run that has it. */
export async function getProvenCost(params?: { version_id?: string; scope?: "current" }): Promise<ProvenCostResponse> {
  const { data } = await apiClient.get<ProvenCostResponse>("/api/v1/insights/proven-cost", { params });
  return data;
}

/* ─── Owner digest cards (spec 8.3) ─── */

export interface OwnerCardResponse {
  owner: string;
  /** The owner's user id: their records open in Fix work (?assignee=). */
  user_id?: string | null;
  score: number;
  delta: number;
  open_by_severity: Record<string, number>;
  fixed_since_baseline: number;
  oldest_item_age_days: number;
  digest: string;
  schedule: string;
  last_sent: string | null;
}

export interface OwnersResponse {
  owners: OwnerCardResponse[];
}

export async function getOwners(): Promise<OwnersResponse> {
  const { data } = await apiClient.get<OwnersResponse>("/api/v1/insights/owners");
  return data;
}

/* ─── Duplicate cluster graph + merge proposals (spec 8.4) ─── */

export interface DuplicateClusterResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  thresholds: { auto_merge: number; review_floor: number };
}

export async function getDuplicateCluster(object: string, recordId: string): Promise<DuplicateClusterResponse> {
  const { data } = await apiClient.get<DuplicateClusterResponse>(
    `/api/v1/insights/duplicates/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`,
  );
  return data;
}

export interface MergeProposalsResponse {
  created: string[];
}

export async function createMergeProposals(
  pairs: { match_score_id: string; priority?: number }[],
): Promise<MergeProposalsResponse> {
  const { data } = await apiClient.post<MergeProposalsResponse>(
    "/api/v1/insights/duplicates/merge-proposals",
    { pairs },
  );
  return data;
}

/* ─── Executive summary (spec 8.5) ─── */

/** One priced feature, tagged with its L1 so the page can tab by process. */
export type ExecWaterfallPoint = ChartPoint & { l1?: string | null };

export interface ExecResponse {
  /** Null for a day-one tenant, and for `scope=current` (the current state of every lineage, not one run). */
  version_id: string | null;
  /**
   * The run the readiness, impact and proven cost come from, and the one to export: `version_id`, or under
   * `scope=current` the newest run of the current state. Null only for a day-one tenant.
   */
  latest_version_id?: string | null;
  /** "current" when the summary describes the current state across objects (api/routes/insights.py:get_exec). */
  scope?: "run" | "current";
  /** The DQS the summary describes: the run's composite, or the current-state composite. Null when nothing is scored. */
  composite?: number | null;
  /** The cap a critical finding holds the score at, when it does (the ruler draws the measured value beyond it). */
  cap?: number | null;
  cap_reason?: string | null;
  narrative: string;
  readiness_cells: ReadinessCell[];
  waterfall: ExecWaterfallPoint[];
  impact_rows: ImpactRow[];
  owner_rows: OwnerCardResponse[];
  proven_cost_by_l1?: CostL1[];
}

/** One run (`version_id`, default the latest), or `scope: "current"` for every object at the latest run of its lineage. */
export async function getExec(params?: { version_id?: string; scope?: "run" | "current" }): Promise<ExecResponse> {
  const { data } = await apiClient.get<ExecResponse>("/api/v1/insights/exec", { params });
  return data;
}

/* ─── AI summary feedback (api/routes/insight_feedback.py) ─── */

export async function submitInsightFeedback(body: { surface: string; run_id?: string | null; vote: "up" | "down" }): Promise<void> {
  await apiClient.post("/api/v1/insights/feedback", body);
}

/* ─── Aggregate endpoints (overview, rules, root causes, heatmap, trends, cleansing) ─── */

export interface NarrativeLine {
  text: string;
  href?: string;
}

export interface OverviewResponse {
  version_id: string;
  run_label: string | null;
  run_at: string | null;
  previous_version_id: string | null;
  dqs: { composite: number | null; previous: number | null; delta: number | null; tier: string | null; capped: boolean; cap_reason: string | null };
  blockers: { count: number; previous: number | null; waves: number };
  auto_fixable: { records: number; failing_records: number; pct: number | null; high_confidence: number };
  /** Worst single L1. There is no total across L1s. */
  value_at_risk: { worst_l1: string | null; worst_l1_amount: number; currency: string; features_blocked: number };
  narrative: NarrativeLine[];
}

export interface RuleRow {
  check_id: string;
  name: string;
  module: string;
  severity: string | null;
  dimension: string | null;
  field: string | null;
  affected: number;
  total: number;
  /** 0..1 */
  pass_rate: number | null;
  impact: number;
  /** 0..100 */
  auto_fix_pct: number;
  s4: string;
  delta_affected: number | null;
  cost_at_risk: number | null;
}

export interface RuleRankingResponse {
  version_id: string;
  rows: RuleRow[];
}

export interface RuleRankingParams {
  version_id?: string;
  module?: string;
  severity?: string;
  dimension?: string;
  auto_fixable?: boolean;
  s4_only?: boolean;
  limit?: number;
}

export interface RootCauseCluster {
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
  impact: number;
  auto_fix_pct: number | null;
  origin: { status: "computed" | "not_computed"; top: string | null; share: number | null };
}

export interface RootCausesResponse {
  version_id: string;
  clusters: RootCauseCluster[];
}

export interface HeatmapRow {
  module: string;
  group: string;
  scores: Record<string, number>;
  tier: Record<string, string>;
  coverage: Record<string, number | null>;
  critical: number;
  cap_reason: string | null;
}

export interface HeatmapResponse {
  version_id: string;
  dimensions: string[];
  rows: HeatmapRow[];
}

export interface TrendRun {
  version_id: string;
  label: string | null;
  run_at: string | null;
  baseline: boolean;
  composite: number | null;
  dimensions: Record<string, number>;
  modules: Record<string, unknown>;
  critical: number;
  /** Failing rules at high severity. */
  high: number;
  failing_rules: number;
  affected_records: number;
  blockers: number;
  auto_fixable_pct: number | null;
  /** Against the run before in the window; null on the first run. */
  change: number | null;
  /** Rules that failed in the run before and pass now; only rules that ran cleanly in both are counted. */
  rules_fixed: number | null;
  rules_new: number | null;
}

export interface TrendAnnotation {
  version_id: string;
  kind: "event" | "change";
  label: string;
}

export interface TrendsResponse {
  lineage: string;
  runs: TrendRun[];
  annotations: TrendAnnotation[];
}

export interface CleansingStep {
  key: "failing" | "proposed" | "high" | "approved" | "applied";
  label: string;
  records: number;
}

export interface CleansingResponse {
  version_id: string;
  currency: string;
  steps: CleansingStep[];
  by_module: { module: string; failing: number; proposed: number; high: number }[];
  by_rule: { check_id: string; proposed: number; high: number; auto: boolean }[];
}

export async function getOverview(params?: { version_id?: string; module?: string }): Promise<OverviewResponse> {
  const { data } = await apiClient.get<OverviewResponse>("/api/v1/insights/overview", { params });
  return data;
}

export async function getRuleRanking(params?: RuleRankingParams): Promise<RuleRankingResponse> {
  const { data } = await apiClient.get<RuleRankingResponse>("/api/v1/insights/rules", { params });
  return data;
}

export async function getRootCauses(params?: { version_id?: string; module?: string }): Promise<RootCausesResponse> {
  const { data } = await apiClient.get<RootCausesResponse>("/api/v1/insights/root-causes", { params });
  return data;
}

export async function getHeatmap(params?: { version_id?: string; module?: string }): Promise<HeatmapResponse> {
  const { data } = await apiClient.get<HeatmapResponse>("/api/v1/insights/heatmap", { params });
  return data;
}

export async function getTrends(params?: { version_id?: string; system_id?: string; limit?: number }): Promise<TrendsResponse> {
  const { data } = await apiClient.get<TrendsResponse>("/api/v1/insights/trends", { params });
  return data;
}

export async function getCleansing(params?: { version_id?: string; module?: string }): Promise<CleansingResponse> {
  const { data } = await apiClient.get<CleansingResponse>("/api/v1/insights/cleansing", { params });
  return data;
}

/* ─── Current state (`scope=current`): every object at the latest finished run of its lineage ─── */

/**
 * What a `scope=current` answer was computed over: the API reads the latest complete run of each lineage
 * (`_latest_version_ids`, as `GET /findings/aggregate`) and takes each object once, from the newest of those runs
 * that measured it (the `stateObjects` rule of `lib/current-state.ts`). `version_ids` are the runs that supply an
 * object, newest first; `objects` pairs each object with its run.
 */
export interface CurrentScope {
  version_id: null;
  scope: "current";
  version_ids: string[];
  objects: { module: string; version_id: string }[];
}

/** The overview of the current state. No single earlier run exists, so `dqs.previous`, `dqs.delta` and `blockers.previous` are null. */
export type CurrentOverviewResponse = Omit<OverviewResponse, "version_id" | "previous_version_id"> & CurrentScope & { previous_version_id: null };

/** Root causes of the current state: each cluster is one object's, computed in that object's run. */
export interface CurrentRootCausesResponse extends CurrentScope {
  clusters: (RootCauseCluster & { version_id: string })[];
}

export type CurrentCleansingResponse = Omit<CleansingResponse, "version_id"> & CurrentScope;

export async function getCurrentOverview(params?: { module?: string }): Promise<CurrentOverviewResponse> {
  const { data } = await apiClient.get<CurrentOverviewResponse>("/api/v1/insights/overview", { params: { ...params, scope: "current" } });
  return data;
}

export async function getCurrentRootCauses(params?: { module?: string }): Promise<CurrentRootCausesResponse> {
  const { data } = await apiClient.get<CurrentRootCausesResponse>("/api/v1/insights/root-causes", { params: { ...params, scope: "current" } });
  return data;
}

export async function getCurrentCleansing(params?: { module?: string }): Promise<CurrentCleansingResponse> {
  const { data } = await apiClient.get<CurrentCleansingResponse>("/api/v1/insights/cleansing", { params: { ...params, scope: "current" } });
  return data;
}
