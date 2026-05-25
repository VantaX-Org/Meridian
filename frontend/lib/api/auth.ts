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
