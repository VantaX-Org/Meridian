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

export async function getImpact(params?: { version_id?: string }): Promise<ImpactResponse> {
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

export interface ProvenCostResponse {
  version_id: string | null;
  currency: string | null;
  total: number;
  rows: ProvenCostRow[];
  /** Per-L1 only. Value at risk is never summed across L1s. */
  value_at_risk_by_l1: ValueAtRiskL1[];
}

/** Largest L1 by value at risk, plus how many processes (L1s) the figure sits among. Never a sum. */
export function largestValueAtRisk(by_l1: ValueAtRiskL1[]): { l1: string; value_at_risk: number; processes: number } | null {
  if (by_l1.length === 0) return null;
  const top = by_l1.reduce((a, b) => (b.value_at_risk > a.value_at_risk ? b : a));
  return { ...top, processes: by_l1.length };
}

export async function getProvenCost(params?: { version_id?: string }): Promise<ProvenCostResponse> {
  const { data } = await apiClient.get<ProvenCostResponse>("/api/v1/insights/proven-cost", { params });
  return data;
}

/* ─── Owner digest cards (spec 8.3) ─── */

export interface OwnerCardResponse {
  owner: string;
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

export interface ExecResponse {
  version_id: string | null;
  narrative: string;
  readiness_cells: ReadinessCell[];
  waterfall: ChartPoint[];
  impact_rows: ImpactRow[];
  owner_rows: OwnerCardResponse[];
  proven_cost_total?: number;
}

export async function getExec(params?: { version_id?: string }): Promise<ExecResponse> {
  const { data } = await apiClient.get<ExecResponse>("/api/v1/insights/exec", { params });
  return data;
}

/* ─── AI summary feedback (api/routes/insight_feedback.py) ─── */

export async function submitInsightFeedback(body: { surface: string; run_id?: string | null; vote: "up" | "down" }): Promise<void> {
  await apiClient.post("/api/v1/insights/feedback", body);
}
