import apiClient from "./client";

export interface DqsForecast {
  module_id: string;
  current_score: number;
  forecast_7d: number;
  forecast_30d: number;
  forecast_90d: number;
  trend: "improving" | "stable" | "declining" | "critical";
  confidence: number;
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

export interface NextBestAction {
  type: "finding" | "cleaning" | "exception";
  id: string;
  title: string;
  priority_score: number;
  estimated_impact_zar: number;
  effort_hours: number;
  roi_per_hour: number;
  recommended_steward: string | null;
  affected_count: number;
  total_count: number;
}

export interface Sprint {
  sprint_number: number;
  name: string;
  actions: NextBestAction[];
  total_effort_hours: number;
  total_impact_zar: number;
  projected_dqs_improvement: number;
}

export interface PrescriptiveResponse {
  actions: NextBestAction[];
  sprints: Sprint[];
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
