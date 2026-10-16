import { AxiosError } from "axios";
import apiClient from "./client";

export interface MiningSummary {
  window_days: number;
  total_patterns: number;
  new_anomalies: number;
  stable_patterns: number;
  coverage_pct: number;
  runs_total: number;
  cost_usd: number;
}

export interface MiningPattern {
  id: string;
  name: string;
  module: string;
  pattern_type: string;
  severity: "critical" | "high" | "medium" | "low";
  occurrences: number;
  first_seen: string;
  last_seen: string;
  confidence: number;
  /** Ordered drift series (oldest → newest). */
  trend: ReadonlyArray<number | null>;
  promoted_to_rule: boolean;
}

export interface MiningPatternsResponse {
  patterns: MiningPattern[];
}

export interface MiningRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "complete" | "failed";
  module: string;
  pattern_count: number;
}

export interface MiningRunsResponse {
  runs: MiningRun[];
}

export const EMPTY_MINING_SUMMARY: MiningSummary = {
  window_days: 30,
  total_patterns: 0,
  new_anomalies: 0,
  stable_patterns: 0,
  coverage_pct: 0,
  runs_total: 0,
  cost_usd: 0,
};

/**
 * Mining API helpers. All three surface a 404 fallback so that the `/mining`
 * route renders cleanly on clusters where the mining service has not yet been
 * rolled out.
 */
export type MiningTask = "dedup" | "anomaly" | "relationship";

/** Queue the dedup, anomaly and relationship miners (or a subset) on an analysis version. */
export async function runMining(versionId: string, include?: MiningTask[]): Promise<{ task_id: string; version_id: string; include: string[] }> {
  const { data } = await apiClient.post<{ task_id: string; version_id: string; include: string[] }>("/api/v1/mining/run", { version_id: versionId, include });
  return data;
}

export async function getMiningSummary(windowDays = 30): Promise<MiningSummary> {
  try {
    const { data } = await apiClient.get<MiningSummary>("/api/v1/mining/summary", {
      params: { window_days: windowDays },
    });
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { ...EMPTY_MINING_SUMMARY, window_days: windowDays };
    }
    throw err;
  }
}

export async function getMiningPatterns(params?: {
  module?: string;
  pattern_type?: string;
  limit?: number;
}): Promise<MiningPatternsResponse> {
  try {
    const { data } = await apiClient.get<MiningPatternsResponse>(
      "/api/v1/mining/patterns",
      { params },
    );
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { patterns: [] };
    }
    throw err;
  }
}

export async function getMiningRuns(limit = 20): Promise<MiningRunsResponse> {
  try {
    const { data } = await apiClient.get<MiningRunsResponse>("/api/v1/mining/runs", {
      params: { limit },
    });
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { runs: [] };
    }
    throw err;
  }
}

export interface MinedDuplicate {
  id: string;
  version_id: string;
  module_id: string;
  record_a: string;
  record_b: string;
  match_score: number;
  id_field: string | null;
  matched_fields: string[] | null;
  detected_at: string;
}

export interface MinedAnomaly {
  id: string;
  version_id: string;
  module_id: string;
  field_name: string;
  field_value: number | null;
  record_index: number | null;
  detection_method: string;
  z_score: number | null;
  severity: "critical" | "high" | "medium" | "low";
  detected_at: string;
}

export interface MinedRelationship {
  id: string;
  version_id: string;
  module_id: string;
  field_a: string;
  field_b: string;
  relationship_type: string;
  strength_score: number;
  detected_at: string;
}

interface MinedParams { version_id?: string; module_id?: string; limit?: number }

/** GET /api/v1/mining/duplicates: record pairs the miner scored as likely duplicates, best match first. */
export async function getMiningDuplicates(params?: MinedParams & { min_score?: number }): Promise<MinedDuplicate[]> {
  const { data } = await apiClient.get<MinedDuplicate[]>("/api/v1/mining/duplicates", { params });
  return data;
}

/** GET /api/v1/mining/anomalies: statistical outliers per field, worst severity first. */
export async function getMiningAnomalies(params?: MinedParams & { severity?: MinedAnomaly["severity"] }): Promise<MinedAnomaly[]> {
  const { data } = await apiClient.get<MinedAnomaly[]>("/api/v1/mining/anomalies", { params });
  return data;
}

/** GET /api/v1/mining/relationships: field pairs that move together. */
export async function getMiningRelationships(params?: MinedParams & { min_strength?: number }): Promise<MinedRelationship[]> {
  const { data } = await apiClient.get<MinedRelationship[]>("/api/v1/mining/relationships", { params });
  return data;
}

export function isMiningAvailable(summary: MiningSummary): boolean {
  return summary.runs_total > 0 || summary.total_patterns > 0;
}
