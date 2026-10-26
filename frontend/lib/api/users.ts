import apiClient from "./client";
import type { User, UserListResponse } from "@/types/api";

export async function getUsers(): Promise<UserListResponse> {
  const { data } = await apiClient.get<UserListResponse>("/api/v1/users");
  return data;
}

/** Active only: a role is never set here, roles are grants (lib/api/roles.ts addGrant). */
export async function updateUser(
  userId: string,
  body: { is_active?: boolean }
): Promise<User> {
  const { data } = await apiClient.put<User>(`/api/v1/users/${userId}`, body);
  return data;
}

/** Invite with grants: the API derives users.role from the unscoped ones. */
export async function inviteUser(body: {
  email: string;
  name?: string;
  grants: { role_key: string; system_id?: string | null; module?: string | null }[];
}): Promise<{ id: string; email: string; role: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/users/invite", body);
  return data;
}

export async function deleteUser(
  userId: string,
): Promise<{ id: string; status: string }> {
  const { data } = await apiClient.delete<{ id: string; status: string }>(
    `/api/v1/users/${userId}`,
  );
  return data;
}

export async function getAssignableUsers(): Promise<{ id: string; name: string; email: string; role: string }[]> {
  const { data } = await apiClient.get("/api/v1/users/assignable");
  return data;
}

/** Clear a user's two-factor sign-in (a lost phone) and end their sessions. Not your own. */
export async function resetUserTwoFactor(userId: string): Promise<{ id: string; totp_enabled: false }> {
  const { data } = await apiClient.post<{ id: string; totp_enabled: false }>(`/api/v1/users/${userId}/2fa/reset`);
  return data;
}

/** Whether every user must sign in with an authenticator code (GET/PUT /settings/security, manage_users). */
export async function getSecuritySettings(): Promise<{ require_2fa: boolean }> {
  const { data } = await apiClient.get<{ require_2fa: boolean }>("/api/v1/settings/security");
  return data;
}

export async function updateSecuritySettings(body: { require_2fa: boolean }): Promise<{ require_2fa: boolean }> {
  const { data } = await apiClient.put<{ require_2fa: boolean }>("/api/v1/settings/security", body);
  return data;
}
