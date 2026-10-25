import { isAxiosError } from "axios";
import apiClient from "./client";
import type { Finding } from "@/types/api";

export interface DqsForecast {
  module_id: string;
  current_score: number;
  /** Each horizon is null when the history is too short to project that far: 30 days needs a 10-day span, 90 days a 30-day span. */
  forecast_7d: number | null;
  forecast_30d: number | null;
  forecast_90d: number | null;
  /** The 95% prediction interval of each horizon, from the fit residuals; null with its point. Optional on older APIs. */
  forecast_7d_low?: number | null;
  forecast_7d_high?: number | null;
  forecast_30d_low?: number | null;
  forecast_30d_high?: number | null;
  forecast_90d_low?: number | null;
  forecast_90d_high?: number | null;
  trend: "improving" | "stable" | "declining" | "critical";
  /** 0–100: 100 minus the width in points of the 7-day interval. Not a probability; show the range instead. */
  confidence: number;
  points: number;
  span_days: number;
  /** The fitted daily scores, `day` counted back from the latest (0 = now). Optional on older APIs. */
  history?: { day: number; score: number }[];
  contributing_factors: string[];
}

export interface EarlyWarning {
  module_id: string;
  signal: "red" | "amber" | "green";
  message: string;
  recommended_action: string;
}

export interface PredictiveResponse {
  forecasts: DqsForecast[];
  early_warnings: EarlyWarning[];
  /** Why `forecasts` is empty: "needs_three_days" until runs span three different days. */
  reason?: string | null;
  /** Finished runs the forecaster saw, and how many distinct days they cover. */
  runs_seen?: number;
  days_seen?: number;
}

/** The tenant's own assumptions behind every planner figure (Admin → Scoring & alerts). */
export interface PlannerAssumptions {
  minutes_per_record: number;
  investigation_hours: number;
  cleaning_item_hours: number;
  exception_hours: number;
  sprint_hours: number;
  cost_per_record: number | null;
  currency: string;
}

export interface NextBestAction {
  type: "finding" | "cleaning" | "exception";
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  affected_count: number;
  total_count: number;
  effort_hours: number;
  /** Severity weight × records affected. */
  impact_points: number;
  value_per_hour: number;
  priority_score: number;
  /** Records × the tenant's cost per record; null until a rate is configured. */
  estimated_cost: number | null;
  currency: string;
  recommended_steward: string | null;
  module?: string;
  check_id?: string;
  dimension?: string;
}

export interface Sprint {
  sprint_number: number;
  name: string;
  actions: NextBestAction[];
  total_effort_hours: number;
  records_fixed: number;
  critical_cleared: number;
  estimated_cost: number | null;
  currency: string;
  /** Composite DQS now and once this sprint's findings pass, through the scoring engine. */
  dqs_now: number | null;
  dqs_projected: number | null;
}

export interface PrescriptiveResponse {
  actions: NextBestAction[];
  sprints: Sprint[];
  assumptions: PlannerAssumptions;
  basis: { version_id: string | null; findings: number; cleaning_items: number; exceptions: number };
}

export interface ImpactBucket {
  category: string;
  annual_risk_zar: number;
  mitigated_zar: number;
  finding_count: number;
  calculation_method: string;
  /**
   * The currency of the amounts: the buckets are priced with fixed rand constants, not the tenant cost model, so the
   * API says "ZAR" (api/services/analytics_engine.py:RISK_CURRENCY). Print with this, never the tenant currency.
   */
  currency: string;
}

export interface RoiSummary {
  /** Null when no subscription is configured: there is no setting for it, so no fee is invented. */
  subscription_annual: number | null;
  risk_mitigated: number;
  /** Null without a configured subscription (nothing to divide by). */
  roi_multiple: number | null;
  /** Null without a configured subscription, or before any cost is avoided. */
  payback_months: number | null;
  /** The currency of the amounts ("ZAR": a fixed rand subscription and rand risk constants, not the cost model). */
  currency: string;
}

export interface ImpactResponse {
  impacts: ImpactBucket[];
  roi: RoiSummary;
  version_id?: string;
}

export async function getImpactAnalytics(
  versionId?: string
): Promise<ImpactResponse> {
  const { data } = await apiClient.get<ImpactResponse>(
    "/api/v1/analytics/impact",
    { params: versionId ? { version_id: versionId } : undefined }
  );
  return data;
}

export interface FindingImpact {
  finding_id: string;
  finding: Finding;
  impacts: ImpactBucket[];
}

/** GET /api/v1/analytics/impact/{findingId} — one finding's cost-at-risk breakdown. Null when the finding has no impact model (404) or an empty breakdown. */
export async function getFindingImpact(findingId: string): Promise<FindingImpact | null> {
  try {
    const { data } = await apiClient.get<FindingImpact>(`/api/v1/analytics/impact/${encodeURIComponent(findingId)}`);
    return data.impacts.length ? data : null;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

export async function getPredictiveAnalytics(
  moduleId?: string
): Promise<PredictiveResponse> {
  const { data } = await apiClient.get<PredictiveResponse>(
    "/api/v1/analytics/predictive",
    { params: moduleId ? { module_id: moduleId } : undefined }
  );
  return data;
}

export async function getPrescriptiveAnalytics(params?: {
  limit?: number;
  type?: NextBestAction["type"];
  /** The run whose findings the actions come from; default the latest finished run. */
  version_id?: string;
}): Promise<PrescriptiveResponse> {
  const { data } = await apiClient.get<PrescriptiveResponse>(
    "/api/v1/analytics/prescriptive",
    { params }
  );
  return data;
}

/** GET /health/llm (api/routes/health.py). Any failure reads as "model off", never as an error. */
export async function getLlmHealth(): Promise<{ llm_available: boolean; reason?: string }> {
  try {
    const { data } = await apiClient.get<{ llm_available: boolean; reason?: string }>("/health/llm");
    return { llm_available: data.llm_available === true, reason: data.reason };
  } catch {
    return { llm_available: false, reason: "unreachable" };
  }
}

/* ─── Operations (api/routes/analytics.py: operational, sprints, bottlenecks, capacity, roi, mdm-health) ─── */

export interface OperationalKpis {
  throughput: number;
  automation_rate: number;
  mttr_hours: number;
  sla_compliance_pct: number;
  rejection_rate: number;
  rollback_rate: number;
  items_in_flight: number;
  avg_queue_age_hours: number;
  /** "N/A" when nothing has been processed yet. */
  top_rule_by_volume?: string;
  top_object_type?: string;
  total_processed?: number;
  total_detected?: number;
}

export interface Bottleneck {
  stage: string;
  count: number;
  avg_age_hours: number;
  recommendation: string;
}

export interface CapacityPlan {
  needed: number;
  current: number;
  surplus_deficit: number;
  recommendation: string;
}

export interface OperationalResponse {
  kpis: OperationalKpis;
  bottlenecks: Bottleneck[];
  capacity: CapacityPlan;
}

export interface TeamPerformance {
  user_id: string;
  summary: {
    total_processed: number;
    total_approved: number;
    total_rejected: number;
    total_review_hours: number;
    approval_rate: number;
    avg_review_hours: number;
  };
}

export interface SprintPlan {
  sprint_number: number;
  name: string;
  total_effort_hours: number;
  records_fixed: number;
  critical_cleared: number;
  estimated_cost: number | null;
  currency: string;
  dqs_now: number | null;
  dqs_projected: number | null;
}

export interface RoiResponse {
  roi: RoiSummary;
  cost_avoidance_history: { period: string; amount?: number }[];
}

export interface MdmHealthPoint {
  snapshot_date: string;
  mdm_health_score: number;
  golden_record_coverage_pct: number;
  avg_match_confidence: number;
  steward_sla_compliance_pct: number;
  source_consistency_pct: number;
  backlog_count: number;
}

export async function getOperational(): Promise<OperationalResponse> {
  return (await apiClient.get<OperationalResponse>("/api/v1/analytics/operational")).data;
}

export async function getTeamPerformance(userId: string): Promise<TeamPerformance> {
  return (await apiClient.get<TeamPerformance>(`/api/v1/analytics/operational/team/${encodeURIComponent(userId)}`)).data;
}

export async function getSprints(maxHours = 40): Promise<{ sprints: SprintPlan[]; total_actions: number }> {
  return (await apiClient.get("/api/v1/analytics/sprints", { params: { max_hours: maxHours } })).data;
}

export async function getRoi(): Promise<RoiResponse> {
  return (await apiClient.get<RoiResponse>("/api/v1/analytics/roi")).data;
}

export async function getMdmHealth(days = 56): Promise<{ data: MdmHealthPoint[]; days: number }> {
  return (await apiClient.get("/api/v1/analytics/mdm-health", { params: { days } })).data;
}
