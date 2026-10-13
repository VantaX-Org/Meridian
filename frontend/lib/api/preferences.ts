import apiClient from "./client";
import type { Preferences, PreferencesPatch } from "../preferences";

/** GET /api/v1/me/preferences: the signed-in user's stored preferences ({} when none). */
export async function getPreferences(): Promise<Preferences> {
  const { data } = await apiClient.get<Preferences>("/api/v1/me/preferences");
  return data;
}

/** PATCH /api/v1/me/preferences: a JSON merge patch (null removes a key); returns the merged document. */
export async function patchPreferences(patch: PreferencesPatch): Promise<Preferences> {
  const { data } = await apiClient.patch<Preferences>("/api/v1/me/preferences", patch);
  return data;
}
