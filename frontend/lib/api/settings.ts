import apiClient from "./client";
import type { AlertThresholds, TenantSettings, DimensionScores, PlannerConfig, CostModel } from "@/types/api";

export async function getSettings(): Promise<TenantSettings> {
  const { data } = await apiClient.get<TenantSettings>("/api/v1/settings");
  return data;
}

export async function updateDqsWeights(
  weights: DimensionScores
): Promise<void> {
  await apiClient.patch("/api/v1/settings/dqs-weights", weights);
}

export async function updateAlertThresholds(thresholds: AlertThresholds): Promise<void> {
  await apiClient.patch("/api/v1/settings/alert-thresholds", thresholds);
}

export async function saveNotificationSettings(config: {
  email: string;
  teams_webhook: string;
  daily_digest: boolean;
  weekly_summary: boolean;
  monthly_report: boolean;
}): Promise<void> {
  await apiClient.post("/api/v1/settings/notifications", config);
}

/** The tenant's default digest and report schedule (POST /settings/notifications). */
export type NotificationConfig = Parameters<typeof saveNotificationSettings>[0];

/** The DQS bands: at or above target is on target, at or above warning is at risk, below critical is failing. */
export interface ScoringBands {
  target: number;
  warning: number;
  critical: number;
}

/**
 * GET/PUT /settings/scoring. Dimension weights come back normalised to 1 and go back summing to 100; the PUT
 * replaces module weights and the severity tables, so a save sends back what the GET returned.
 */
export interface ScoringConfig {
  dimension_weights: DimensionScores;
  module_weights: Record<string, number>;
  thresholds: ScoringBands;
  severity_weights: Record<string, number>;
  severity_multipliers: Record<string, number>;
  critical_tolerance: Record<string, number>;
}

export interface ScoringResponse extends ScoringConfig {
  /** The built-in config, for "use defaults". */
  defaults: ScoringConfig;
}

export async function getScoring(): Promise<ScoringResponse> {
  const { data } = await apiClient.get<ScoringResponse>("/api/v1/settings/scoring");
  return data;
}

export async function putScoring(config: ScoringConfig): Promise<void> {
  await apiClient.put("/api/v1/settings/scoring", config);
}

export async function savePlannerConfig(config: PlannerConfig): Promise<void> {
  await apiClient.post("/api/v1/settings/planner", config);
}

/** The effective cost model (defaults with the tenant's overrides laid over them); the API wraps it as `{defaults, tenant, effective}`. */
export async function getCostModel(): Promise<CostModel> {
  const { data } = await apiClient.get<{ effective: CostModel }>("/api/v1/settings/cost-model");
  return data.effective;
}

/** A feature a value per blocked record can be set for: every target feature of the config impact rules. */
export interface CostModelFeature {
  feature: string;
  l1: string | null;
}

export async function getCostModelFeatures(): Promise<CostModelFeature[]> {
  const { data } = await apiClient.get<{ features: CostModelFeature[] }>("/api/v1/settings/cost-model/features");
  return data.features;
}

export async function updateCostModel(model: CostModel): Promise<void> {
  await apiClient.put("/api/v1/settings/cost-model", model);
}
