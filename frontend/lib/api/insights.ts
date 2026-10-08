import apiClient from "./client";

/* ─── Readiness (spec 8.1) ─── */

export interface ReadinessCell {
  module: string;
  wave: string;
  verdict: "go" | "at_risk" | "no_go";
  blocker_count: number;
  dqs: number | null;
}

export interface ReadinessResponse {
  version_id: string | null;
  threshold: number;
  cells: ReadinessCell[];
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
