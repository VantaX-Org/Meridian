import { AxiosError } from "axios";
import apiClient from "./client";

export interface LlmSavingsSeriesPoint {
  date: string;
  calls_total: number;
  calls_saved: number;
  tokens_saved: number;
  cost_saved_usd: number;
  avg_latency_ms: number | null;
}

export interface LlmSavingsSummary {
  window_days: number;
  reduction_pct: number;
  calls_total: number;
  calls_saved: number;
  tokens_saved: number;
  cost_saved_usd: number;
  deterministic_ratio: number;
  avg_latency_ms: number | null;
  previous_period: {
    reduction_pct: number;
    cost_saved_usd: number;
  } | null;
  series: LlmSavingsSeriesPoint[];
}

export interface LlmSavingsByServiceRow {
  service: string;
  calls_total: number;
  calls_saved: number;
  reduction_pct: number;
  cost_saved_usd: number;
  p95_latency_ms: number | null;
  trend: ReadonlyArray<number | null>;
}

export interface LlmSavingsByServiceResponse {
  rows: LlmSavingsByServiceRow[];
}

export const EMPTY_SUMMARY: LlmSavingsSummary = {
  window_days: 30,
  reduction_pct: 0,
  calls_total: 0,
  calls_saved: 0,
  tokens_saved: 0,
  cost_saved_usd: 0,
  deterministic_ratio: 0,
  avg_latency_ms: null,
  previous_period: null,
  series: [],
};

export const EMPTY_BY_SERVICE: LlmSavingsByServiceResponse = { rows: [] };

/**
 * Fetch the aggregate LLM savings summary.
 *
 * Defensive fallback: returns `EMPTY_SUMMARY` when the endpoint is not
 * deployed on this tenant (404) so the page renders an empty state rather
 * than a broken card. Other errors propagate as usual.
 */
export async function getLlmSavingsSummary(windowDays = 30): Promise<LlmSavingsSummary> {
  try {
    const { data } = await apiClient.get<LlmSavingsSummary>(
      "/api/v1/metrics/llm-savings",
      { params: { window_days: windowDays } },
    );
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { ...EMPTY_SUMMARY, window_days: windowDays };
    }
    throw err;
  }
}

export async function getLlmSavingsByService(
  windowDays = 30,
): Promise<LlmSavingsByServiceResponse> {
  try {
    const { data } = await apiClient.get<LlmSavingsByServiceResponse>(
      "/api/v1/metrics/llm-savings/by-service",
      { params: { window_days: windowDays } },
    );
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return EMPTY_BY_SERVICE;
    }
    throw err;
  }
}
