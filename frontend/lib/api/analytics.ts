import apiClient from "./client";

export interface DqsForecast {
  module_id: string;
  current_score: number;
  forecast_7d: number;
  forecast_30d: number;
  forecast_90d: number;
  trend: "improving" | "stable" | "declining" | "critical";
  /** 50–95: a heuristic that grows with the number of runs, not a statistical interval. */
  confidence: number;
  points: number;
  span_days: number;
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
}

export interface RoiSummary {
  subscription_annual: number;
  risk_mitigated: number;
  roi_multiple: number;
  payback_months: number;
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
}): Promise<PrescriptiveResponse> {
  const { data } = await apiClient.get<PrescriptiveResponse>(
    "/api/v1/analytics/prescriptive",
    { params }
  );
  return data;
}
