import apiClient from "@/lib/api/client";
import { fixtureActive } from "./fixture";
import { fixtureResponse, fixtureWrite } from "./fixtures";

type Params = Record<string, string | number | boolean | undefined | null>;

const clean = (params?: Params): Record<string, string | number | boolean> | undefined =>
  params ? (Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Record<string, string | number | boolean>) : undefined;

/**
 * The one read path of the v2 clients. In fixture mode the answer comes from lib/api/v2/fixtures; otherwise it is a
 * GET on /api/v1 through the shared axios client (bearer token, retry, licence and access handling).
 */
export async function v2Get<T>(path: string, params?: Params): Promise<T> {
  const query = clean(params);
  if (fixtureActive()) return fixtureResponse<T>(path, query ?? {});
  const { data } = await apiClient.get<T>(`/api/v1${path}`, { params: query });
  return data;
}

/** A write (POST, PUT, DELETE). Fixture mode applies it to the in-memory fixture so the screen shows the change. */
export async function v2Send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, params?: Params): Promise<T> {
  const query = clean(params);
  if (fixtureActive()) return fixtureWrite<T>(method, path, body, query ?? {});
  const { data } = await apiClient.request<T>({ method, url: `/api/v1${path}`, data: body, params: query });
  return data;
}

/** The sentence a failed request carries: the API's `detail` when it has one, else the fallback. Never a stack trace. */
export function errorSentence(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message.trim() && !/^Request failed with status code/.test(message) && !/^Network Error$/.test(message)) return message;
  return fallback;
}
