/** Scoring weights, cost model and score history. All fields optional;
 *  a missing endpoint resolves to null. */
import apiClient from "./client";
import { optional } from "./optional";

export interface ScoringSettings {
  dimension_weights?: Record<string, number>;
  module_weights?: Record<string, number>;
  thresholds?: { pass?: number; warn?: number };
  defaults?: {
    dimension_weights?: Record<string, number>;
    module_weights?: Record<string, number>;
    thresholds?: { pass?: number; warn?: number };
  };
}

export interface CostSpec { per_record?: number; field?: string; factor?: number }
export interface CostModel {
  currency?: string;
  severity?: Record<string, CostSpec>;
  modules?: Record<string, CostSpec>;
  rules?: Record<string, CostSpec>;
}

export interface ScoreHistoryRow {
  version_id?: string;
  run_at?: string;
  system_id?: string | null;
  scoring_recorded?: boolean;
  at_the_time?: { composite?: number | null; tier?: string | null };
  under_current?: { composite?: number | null; tier?: string | null };
}

export const getScoring = () =>
  optional(async () => (await apiClient.get<ScoringSettings>("/api/v1/settings/scoring")).data);

export const putScoring = async (body: {
  dimension_weights: Record<string, number>; module_weights: Record<string, number>; thresholds: { pass: number; warn: number };
}) => (await apiClient.put<ScoringSettings>("/api/v1/settings/scoring", body)).data;

export const getCostModel = () =>
  optional(async () => (await apiClient.get<{ defaults?: CostModel; tenant?: CostModel; effective?: CostModel }>(
    "/api/v1/settings/cost-model")).data);

export const putCostModel = async (body: CostModel) =>
  (await apiClient.put<{ status?: string; effective?: CostModel }>("/api/v1/settings/cost-model", body)).data;

export const getScoreHistory = (limit = 20) =>
  optional(async () => (await apiClient.get<{ history?: ScoreHistoryRow[] }>("/api/v1/scores/history", { params: { limit } })).data);
