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
