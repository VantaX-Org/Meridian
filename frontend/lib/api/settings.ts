import apiClient from "./client";
import type { TenantSettings, DimensionScores } from "@/types/api";

export async function getSettings(): Promise<TenantSettings> {
  const { data } = await apiClient.get<TenantSettings>("/api/v1/settings");
  return data;
}

export async function updateDqsWeights(
  weights: DimensionScores
): Promise<void> {
  await apiClient.patch("/api/v1/settings/dqs-weights", weights);
}

export async function updateAlertThresholds(thresholds: {
  critical_threshold: number;
  high_threshold: number;
  dqs_drop_threshold: number;
}): Promise<void> {
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
