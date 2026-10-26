import apiClient from "./client";

/**
 * Redeem an invitation token by setting the user's first password.
 * Single-use server-side — succeeds only while the user has no password yet.
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ ok: true; email: string }> {
  const { data } = await apiClient.post<{ ok: true; email: string }>(
    "/api/v1/auth/accept-invite",
    { token, password },
  );
  return data;
}

/** localStorage key of the session token (the apiClient interceptor reads it on every request). */
const TOKEN_KEY = "mn_auth_token";

/**
 * POST /api/v1/auth/change-password: rotate the signed-in user's own password.
 * A wrong current password is a 422 (not a 401), so it never signs the user out.
 * The change revokes every session issued before it, this one included, so the
 * response's replacement token is stored in place of the old one and returned.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<string> {
  const { data } = await apiClient.post<{ ok: true; token: string }>(
    "/api/v1/auth/change-password",
    { current_password: currentPassword, new_password: newPassword },
  );
  if (typeof data?.token !== "string" || !data.token) {
    throw new Error("Your password was changed, but no new session came back. Sign in again.");
  }
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

/**
 * Request a password-reset email. Always succeeds — the server never reveals
 * whether the account exists, to prevent enumeration.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true }> {
  const { data } = await apiClient.post<{ ok: true }>(
    "/api/v1/auth/forgot-password",
    { email },
  );
  return data;
}

/**
 * Set a new password from an emailed reset token.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ ok: true; email: string }> {
  const { data } = await apiClient.post<{ ok: true; email: string }>(
    "/api/v1/auth/reset-password",
    { token, password },
  );
  return data;
}

/** role → permitted actions, straight from the server's RBAC matrix. */
export async function getRoleMatrix(): Promise<Record<string, string[]>> {
  const { data } = await apiClient.get("/api/v1/auth/roles");
  return data;
}

export interface InviteGrant { role_key: string; role_label: string; system_id?: string | null; system_name?: string | null; module?: string | null }

/** What an invite token grants, shown before the invitee sets a password. 404 when invalid, expired or used. */
export async function getInvitePreview(token: string): Promise<{ email: string; grants: InviteGrant[] }> {
  const { data } = await apiClient.post<{ email: string; grants: InviteGrant[] }>("/api/v1/auth/invite/preview", { token });
  return data;
}
