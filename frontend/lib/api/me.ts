import apiClient from "./client";

export interface RoleRef { key: string; name: string; system_id: string | null; module: string | null }
export interface ScopeRef { system_id: string | null; module: string | null }

/** Shape shared by GET /me/permissions and GET /users/{id}/effective (rbac.md §3.3). */
export interface EffectivePermissions {
  role: string;
  roles: RoleRef[];
  actions: string[];
  resources: Record<string, Record<string, boolean>>;
  scopes: ScopeRef[];
  home: string;
}

export interface ScopeQuery { system_id?: string; module?: string }

export async function getMyPermissions(params?: ScopeQuery): Promise<EffectivePermissions> {
  const { data } = await apiClient.get<EffectivePermissions>("/api/v1/me/permissions", { params });
  return data;
}

export interface AccessRequest {
  id: string;
  user_id: string;
  resource: string;
  action: string;
  system_id: string | null;
  module: string | null;
  reason: string | null;
  status: "open" | "granted" | "declined";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export async function createAccessRequest(body: {
  resource: string; action: string; system_id?: string | null; module?: string | null; reason?: string;
}): Promise<AccessRequest> {
  const { data } = await apiClient.post<AccessRequest>("/api/v1/access-requests", body);
  return data;
}

export async function listAccessRequests(status?: AccessRequest["status"]): Promise<AccessRequest[]> {
  const { data } = await apiClient.get<AccessRequest[]>("/api/v1/access-requests", { params: status ? { status } : undefined });
  return data;
}

export async function decideAccessRequest(
  id: string, body: { decision: "granted" | "declined"; reason?: string; role_key?: string },
): Promise<AccessRequest> {
  const { data } = await apiClient.post<AccessRequest>(`/api/v1/access-requests/${id}/decide`, body);
  return data;
}
