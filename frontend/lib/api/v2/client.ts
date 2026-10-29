import apiClient from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { fixtureResponse } from "./fixtures";

/**
 * The one read path of the v2 clients. In fixture mode the answer comes from lib/api/v2/fixtures; otherwise it is a
 * GET on /api/v1 through the shared axios client (bearer token, retry, licence and access handling).
 */
export async function v2Get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")) : undefined;
  if (fixtureActive()) return fixtureResponse<T>(path, clean ?? {});
  const { data } = await apiClient.get<T>(`/api/v1${path}`, { params: clean });
  return data;
}
