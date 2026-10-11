import apiClient from "./client";
import type { EffectivePermissions, ScopeQuery } from "./me";

export interface Role {
  key: string;
  name: string;
  description: string | null;
  built_in: boolean;
  legacy: boolean;
  cloned_from: string | null;
  updated_at: string | null;
  users: number | null;
}

/** resource -> action -> allowed. */
export type Matrix = Record<string, Record<string, boolean>>;
export interface RoleMatrix { key: string; built_in: boolean; matrix: Matrix }
export interface Pair { resource: string; action: string }

export interface Grant {
  id: string;
  role_key: string;
  system_id: string | null;
  module: string | null;
  user_id: string | null;
  granted_by: string | null;
  created_at: string | null;
}
export interface GrantInput { role_key: string; system_id?: string | null; module?: string | null }

export interface ConvertResult { converted: string[]; skipped: string[]; kept: string[]; cleared: boolean; confirmed: boolean }

const enc = encodeURIComponent;

export async function listRoles(): Promise<Role[]> {
  const { data } = await apiClient.get<Role[]>("/api/v1/roles");
  return data;
}
export async function cloneRole(body: { name: string; cloned_from: string; description?: string }): Promise<Role> {
  const { data } = await apiClient.post<Role>("/api/v1/roles", body);
  return data;
}
export async function updateRole(key: string, body: { name?: string; description?: string }): Promise<Role> {
  const { data } = await apiClient.put<Role>(`/api/v1/roles/${enc(key)}`, body);
  return data;
}
export async function deleteRole(key: string): Promise<{ key: string; status: string }> {
  const { data } = await apiClient.delete<{ key: string; status: string }>(`/api/v1/roles/${enc(key)}`);
  return data;
}
export async function getRolePermissions(key: string): Promise<RoleMatrix> {
  const { data } = await apiClient.get<RoleMatrix>(`/api/v1/roles/${enc(key)}/permissions`);
  return data;
}
export async function putRolePermissions(key: string, permissions: Pair[]): Promise<RoleMatrix> {
  const { data } = await apiClient.put<RoleMatrix>(`/api/v1/roles/${enc(key)}/permissions`, { permissions });
  return data;
}

export async function listGrants(userId: string): Promise<Grant[]> {
  const { data } = await apiClient.get<Grant[]>(`/api/v1/users/${userId}/grants`);
  return data;
}
export async function addGrant(userId: string, body: GrantInput): Promise<Grant> {
  const { data } = await apiClient.post<Grant>(`/api/v1/users/${userId}/grants`, body);
  return data;
}
export async function deleteGrant(userId: string, grantId: string): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.delete<{ id: string; status: string }>(`/api/v1/users/${userId}/grants/${grantId}`);
  return data;
}
export async function convertObjectApprovals(userId: string, confirm: boolean): Promise<ConvertResult> {
  const { data } = await apiClient.post<ConvertResult>(`/api/v1/users/${userId}/object-approvals/convert`, { confirm });
  return data;
}
export async function getUserEffective(userId: string, params?: ScopeQuery): Promise<EffectivePermissions> {
  const { data } = await apiClient.get<EffectivePermissions>(`/api/v1/users/${userId}/effective`, { params });
  return data;
}
