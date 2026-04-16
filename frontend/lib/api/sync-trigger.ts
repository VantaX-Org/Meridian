import apiClient from "./client";

export interface ModuleStatus {
  module_id: string;
  label: string;
  category: string;
  status: "idle" | "running" | "completed" | "failed";
  last_run_at: string | null;
}

export interface TriggerResponse {
  queued: string[];
  skipped: string[];
}

export async function getModuleStatuses(): Promise<ModuleStatus[]> {
  const res = await apiClient.get<ModuleStatus[]>("/api/v1/sync-trigger/modules");
  return res.data;
}

export async function triggerModules(module_ids: string[]): Promise<TriggerResponse> {
  const res = await apiClient.post<TriggerResponse>("/api/v1/sync-trigger/trigger", {
    module_ids,
  });
  return res.data;
}
