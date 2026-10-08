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
