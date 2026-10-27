import apiClient from "./client";
import type {
  SAPSystemExtended,
  SystemModule,
  ConfigSnapshot,
  ConfigImpactResult,
  ConfigImpactSummary,
  BusinessProcessL1,
} from "@/types/api";

export async function getSystems(): Promise<SAPSystemExtended[]> {
  const { data } = await apiClient.get<SAPSystemExtended[]>("/api/v1/systems");
  return data;
}

// testConnection once lived here pointing at POST /connectivity/health-check/{id} — a Celery
// dispatcher whose only answer is {job_id, status:"queued"}, typed as {status, message, latency_ms}.
// The system page's button read that as a failed health check, so a healthy system could never
// pass its own "Test connection". The honest client is lib/api/systems.testConnection (POST
// /systems/{id}/test, returns the outcome); this module must not resurrect a second vocabulary.

export async function getSystemModules(
  systemId: string
): Promise<SystemModule[]> {
  const { data } = await apiClient.get<SystemModule[]>(
    `/api/v1/connectivity/systems/${systemId}/modules`
  );
  return data;
}

export async function extractModules(
  systemId: string,
  modules: string[],
  includeConfig: boolean,
  syncType: "full" | "delta"
): Promise<{ job_id: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/connectivity/extract", {
    system_id: systemId,
    modules,
    include_config: includeConfig,
    sync_type: syncType,
  });
  return data;
}

export async function syncConfig(
  systemId: string,
  modules: string[]
): Promise<{ job_id: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/connectivity/config-sync", {
    system_id: systemId,
    modules,
  });
  return data;
}

export async function getConfigSnapshot(
  systemId: string,
  module: string
): Promise<ConfigSnapshot> {
  const { data } = await apiClient.get<ConfigSnapshot>(
    `/api/v1/connectivity/config/${systemId}/${module}`
  );
  return data;
}

export async function getConfigImpact(
  versionId: string
): Promise<{ results: ConfigImpactResult[]; summary: ConfigImpactSummary }> {
  const { data } = await apiClient.get(
    `/api/v1/config-impact/${versionId}`
  );
  return data;
}

export async function getBusinessProcess(
  versionId: string,
  module: string
): Promise<BusinessProcessL1[]> {
  const { data } = await apiClient.get<{ processes: BusinessProcessL1[] }>(
    `/api/v1/business-process/${versionId}/${module}`
  );
  return data.processes;
}

export async function getSPROConfig(
  module: string,
  systemId?: string
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(
    `/api/v1/spro/config/${module}`,
    { params: systemId ? { system_id: systemId } : undefined }
  );
  return data;
}
