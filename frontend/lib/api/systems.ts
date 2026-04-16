import apiClient from "./client";
import type {
  SAPSystem,
  SAPSystemListResponse,
  SyncProfile,
  SyncRun,
  TestConnectionResponse,
} from "@/types/api";

export async function getSystems(): Promise<SAPSystem[]> {
  const { data } = await apiClient.get<SAPSystem[]>("/api/v1/systems");
  return data;
}

export async function registerSystem(body: {
  name: string;
  host: string;
  client: string;
  sysnr: string;
  description?: string;
  environment: string;
  password: string;
}): Promise<SAPSystem> {
  const { data } = await apiClient.post<SAPSystem>("/api/v1/systems", body);
  return data;
}

export async function updateSystem(
  systemId: string,
  body: {
    name?: string;
    host?: string;
    client?: string;
    sysnr?: string;
    description?: string;
    environment?: string;
    is_active?: boolean;
    password?: string;
  }
): Promise<SAPSystem> {
  const { data } = await apiClient.put<SAPSystem>(
    `/api/v1/systems/${systemId}`,
    body
  );
  return data;
}

export async function deleteSystem(systemId: string): Promise<void> {
  await apiClient.delete(`/api/v1/systems/${systemId}`);
}

export async function testConnection(
  systemId: string
): Promise<TestConnectionResponse> {
  const { data } = await apiClient.post<TestConnectionResponse>(
    `/api/v1/systems/${systemId}/test`
  );
  return data;
}

export async function triggerSync(
  systemId: string
): Promise<{ status: string; profile_count: number; job_ids: string[] }> {
  const { data } = await apiClient.post(
    `/api/v1/systems/${systemId}/sync`
  );
  return data;
}

export async function getSyncProfiles(
  systemId: string
): Promise<SyncProfile[]> {
  const { data } = await apiClient.get<SyncProfile[]>(
    `/api/v1/systems/${systemId}/profiles`
  );
  return data;
}

export async function createSyncProfile(
  systemId: string,
  body: {
    system_id: string;
    domain: string;
    tables: string[];
    schedule_cron?: string;
    active?: boolean;
  }
): Promise<SyncProfile> {
  const { data } = await apiClient.post<SyncProfile>(
    `/api/v1/systems/${systemId}/profiles`,
    body
  );
  return data;
}

export async function getSyncRuns(
  systemId: string,
  limit?: number
): Promise<SyncRun[]> {
  const { data } = await apiClient.get<SyncRun[]>(
    `/api/v1/systems/${systemId}/runs`,
    { params: { limit: limit ?? 20 } }
  );
  return data;
}
