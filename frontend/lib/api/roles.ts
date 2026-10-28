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
  /** ISO time the grant stops authorising; null for no expiry. */
  expires_at?: string | null;
}
export interface GrantInput { role_key: string; system_id?: string | null; module?: string | null; expires_at?: string | null }

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

/* ─── Matrix of every role (GET /roles/matrix) ─── */

export interface MatrixRole {
  key: string;
  name: string;
  built_in: boolean;
  legacy: boolean;
  matrix: Matrix;
  /** The legacy action strings the role implies (the ones `can()` and the nav read). */
  legacy_actions: string[];
}
export interface RolesMatrix { resources: string[]; actions: string[]; roles: MatrixRole[] }

export async function getRolesMatrix(): Promise<RolesMatrix> {
  const { data } = await apiClient.get<RolesMatrix>("/api/v1/roles/matrix");
  return data;
}

/* ─── Preview a grant before it is saved (GET /users/{id}/effective?with_grant=) ─── */

export interface GrantDiff {
  added_actions: string[];
  /** [resource, action] cells that become allowed. */
  added_pairs: [string, string][];
  /** Scope of each role the grant adds; both null means every system. */
  widened_scopes: { system_id: string | null; module: string | null }[];
}
export interface GrantPreview { before: EffectivePermissions; after: EffectivePermissions; diff: GrantDiff }

export async function previewGrant(userId: string, grant: { role_key: string; system_id?: string | null; module?: string | null }): Promise<GrantPreview> {
  const params: Record<string, string> = { with_grant: grant.role_key };
  if (grant.system_id) params.system_id = grant.system_id;
  if (grant.module) params.module = grant.module;
  const { data } = await apiClient.get<GrantPreview>(`/api/v1/users/${enc(userId)}/effective`, { params });
  return data;
}
