import apiClient from "./client";
import type {
  SAPSystem,
  SyncProfile,
  SyncRun,
  SystemType,
  TestConnectionResponse,
} from "@/types/api";

export async function registerSystem(body: {
  name: string;
  system_type: SystemType;
  environment: string;
  description?: string;
  // RFC fields (ecc, s4hana_onprem, ewm)
  host?: string;
  client?: string;
  sysnr?: string;
  // RFC: overrides the global SAP_RFC_USER if set. Cloud basic-auth: the username.
  username?: string;
  // Cloud fields (s4hana_cloud, successfactors, concur, ariba, btp)
  base_url?: string;
  company_id?: string;
  auth_type?: string;
  // OAuth client credentials token endpoint (s4hana_cloud, btp: the XSUAA /oauth/token URL)
  token_url?: string;
  // RFC: { password }. Cloud: { client_id, client_secret, api_key, password? (basic auth) }
  credentials: Record<string, string>;
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
    username?: string;
    base_url?: string;
    company_id?: string;
    auth_type?: string;
    token_url?: string; // "" clears it
    description?: string;
    environment?: string;
    is_active?: boolean;
    // Only the secrets the user retyped; an absent key keeps the stored value.
    credentials?: Record<string, string>;
    role?: "source" | "target";
    target_system_id?: string; // "" clears the target
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

// Tests connection parameters before the system is registered/saved.
export async function testDraftConnection(body: {
  name: string;
  system_type: SystemType;
  environment: string;
  host?: string;
  client?: string;
  sysnr?: string;
  username?: string;
  base_url?: string;
  company_id?: string;
  auth_type?: string;
  token_url?: string;
  credentials: Record<string, string>;
}): Promise<TestConnectionResponse> {
  const { data } = await apiClient.post<TestConnectionResponse>(
    "/api/v1/systems/test-connection",
    body
  );
  return data;
}

/**
 * Tests an existing system's edited, unsaved connection fields. A secret left out of
 * `credentials` falls back to the one stored for this system; nothing is saved.
 */
export async function testEditedConnection(
  systemId: string,
  body: Parameters<typeof testDraftConnection>[0]
): Promise<TestConnectionResponse> {
  const { data } = await apiClient.post<TestConnectionResponse>(
    `/api/v1/systems/${systemId}/test-connection`,
    body
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
    extraction_mode?: "full" | "delta";
  }
): Promise<SyncProfile> {
  const { data } = await apiClient.post<SyncProfile>(
    `/api/v1/systems/${systemId}/profiles`,
    body
  );
  return data;
}

export async function updateSyncProfile(
  systemId: string,
  profileId: string,
  body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" }
): Promise<SyncProfile> {
  const { data } = await apiClient.patch<SyncProfile>(
    `/api/v1/systems/${systemId}/profiles/${profileId}`,
    body
  );
  return data;
}

// Needs DELETE /api/v1/systems/{id}/profiles/{profile_id} on the API (api/routes/systems.py); not there yet.
export async function deleteSyncProfile(systemId: string, profileId: string): Promise<void> {
  await apiClient.delete(`/api/v1/systems/${systemId}/profiles/${profileId}`);
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
