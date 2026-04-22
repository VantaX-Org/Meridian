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

export function isMiningAvailable(summary: MiningSummary): boolean {
  return summary.runs_total > 0 || summary.total_patterns > 0;
}
