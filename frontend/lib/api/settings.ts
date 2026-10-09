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

export async function savePlannerConfig(config: PlannerConfig): Promise<void> {
  await apiClient.post("/api/v1/settings/planner", config);
}

export async function getCostModel(): Promise<CostModel> {
  const { data } = await apiClient.get<CostModel>("/api/v1/settings/cost-model");
  return data;
}

export async function updateCostModel(model: CostModel): Promise<void> {
  await apiClient.put("/api/v1/settings/cost-model", model);
}
