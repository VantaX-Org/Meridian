import apiClient from "./client";
import type { User, UserListResponse, UserStatus } from "@/types/api";

/** Server-side filters of GET /users; all optional and applied together. */
export interface UserFilters { q?: string; status?: UserStatus; role?: string; system_id?: string }

/** Every user. Takes no argument on purpose: pages hand it straight to useQuery as `queryFn`. */
export async function getUsers(): Promise<UserListResponse> {
  const { data } = await apiClient.get<UserListResponse>("/api/v1/users");
  return data;
}

/** Users matching the filters, applied by the API. */
export async function searchUsers(filters: UserFilters): Promise<UserListResponse> {
  const { data } = await apiClient.get<UserListResponse>("/api/v1/users", { params: filters });
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

/* ─── Invite and password lifecycle (api/routes/users.py) ─── */

const enc = encodeURIComponent;

export async function resendInvite(userId: string): Promise<{ id: string; invite_status: string; invite_expires_at: string }> {
  const { data } = await apiClient.post(`/api/v1/users/${enc(userId)}/invite/resend`);
  return data;
}

/** A fresh accept link for the admin to hand over; the API audits the copy. */
export async function createInviteLink(userId: string): Promise<{ id: string; url: string; expires_at: string }> {
  const { data } = await apiClient.post(`/api/v1/users/${enc(userId)}/invite/link`);
  return data;
}

/** Forces a password change and signs the user out; emails the link, or returns a one-time link. */
export async function resetPassword(userId: string, sendEmail: boolean): Promise<{ id: string; must_change_password: boolean; emailed: boolean; link: string | null }> {
  const { data } = await apiClient.post(`/api/v1/users/${enc(userId)}/reset-password`, { send_email: sendEmail });
  return data;
}

export type BulkAction = "suspend" | "reactivate" | "resend" | "reset";
export interface BulkResult { id: string; ok: boolean; error: string | null }
export interface BulkResponse { action: BulkAction; results: BulkResult[]; succeeded: number; failed: number }

export async function bulkUsers(ids: string[], action: BulkAction): Promise<BulkResponse> {
  const { data } = await apiClient.post<BulkResponse>("/api/v1/users/bulk", { ids, action });
  return data;
}

/* ─── CSV import ─── */

export interface ImportRow {
  line: number;
  email: string;
  name: string;
  role: string;
  system_id: string | null;
  system_name: string | null;
  module: string | null;
  ok: boolean;
  error: string | null;
}
export interface ImportSeats { used: number; limit: number | null; needed: number; available: number | null; ok: boolean }
export interface ImportPreview { rows: ImportRow[]; accepted: number; rejected: number; seats: ImportSeats }
export interface ImportResult {
  created: { line: number; id: string; email: string }[];
  skipped: { line: number; email: string; error: string }[];
}

export async function previewUserImport(csv: string): Promise<ImportPreview> {
  const { data } = await apiClient.post<ImportPreview>("/api/v1/users/import/preview", { csv });
  return data;
}

export async function importUsers(csv: string): Promise<ImportResult> {
  const { data } = await apiClient.post<ImportResult>("/api/v1/users/import", { csv });
  return data;
}
