import apiClient from "./client";

export type ApiKeyStatus = "active" | "expired" | "revoked" | "suspended";

/** One grant of the key's service account. */
export interface ApiKeyGrant {
  id: string;
  role_key: string;
  role_name: string;
  system_id: string | null;
  system_name: string | null;
  module: string | null;
}

/** A key as listed: the secret and its digest are never returned. */
export interface ApiKey {
  id: string;
  name: string;
  /** The public part of `mk_<prefix>.<secret>`. */
  key_prefix: string;
  user_id: string;
  status: ApiKeyStatus;
  grants: ApiKeyGrant[];
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** The create response: the only time the full key is returned. */
export interface ApiKeyCreated extends ApiKey { key: string }

export interface ApiKeyGrantInput { role_key: string; system_id?: string | null; module?: string | null }
export interface CreateApiKeyBody {
  name: string;
  grants: ApiKeyGrantInput[];
  /** ISO time the key stops working; omit for a key that never expires. */
  expires_at?: string | null;
}

const BASE = "/api/v1/admin/api-keys";
const enc = encodeURIComponent;

export async function listApiKeys(): Promise<ApiKey[]> {
  const { data } = await apiClient.get<ApiKey[]>(BASE);
  return data;
}
export async function createApiKey(body: CreateApiKeyBody): Promise<ApiKeyCreated> {
  const { data } = await apiClient.post<ApiKeyCreated>(BASE, body);
  return data;
}
export async function revokeApiKey(id: string): Promise<ApiKey> {
  const { data } = await apiClient.post<ApiKey>(`${BASE}/${enc(id)}/revoke`);
  return data;
}
export async function deleteApiKey(id: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.delete<{ id: string; status: string }>(`${BASE}/${enc(id)}`);
  return data;
}
