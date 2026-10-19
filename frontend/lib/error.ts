import { isAxiosError } from "axios";

/**
 * The API's own detail message for a failed request, or null when there isn't
 * one (network failure, non-API error, etc). Callers show this — never the
 * raw Error/AxiosError message — falling back to a generic sentence.
 *
 * FastAPI's `detail` can be a string, a validation-error array, or an object
 * carrying an `errors` array; all three are flattened to one sentence here.
 */
export function apiErrorDetail(error: unknown): string | null {
  if (!isAxiosError<{ detail?: unknown }>(error)) return null;
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === "string" ? d : (d as { msg?: string })?.msg ?? JSON.stringify(d))).join("; ");
  }
  if (detail && typeof detail === "object" && Array.isArray((detail as { errors?: unknown }).errors)) {
    return (detail as { errors: unknown[] }).errors.map(String).join("; ");
  }
  return null;
}

/** The machine `reason` inside a structured `detail` object ({"detail": {"reason": "no_baseline"}}), or null. */
export function apiErrorReason(error: unknown): string | null {
  if (!isAxiosError<{ detail?: unknown }>(error)) return null;
  const detail = error.response?.data?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const reason = (detail as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

/** The API's detail, else a gateway-timeout sentence for 502–504, else "Could not reach the server." */
export function apiErrorMessage(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status ?? 0 : 0;
  return apiErrorDetail(error) ?? (status >= 502 && status <= 504 ? "The server is busy and did not answer in time. Try again." : "Could not reach the server.");
}

/**
 * Title and message for an `ErrorState` from a failed request. The title says what actually happened: only a
 * request that got no response is "Could not reach the server."; a 404 reads as not found, a 401/403 as access,
 * anything else the server answered as a server error. The message is the API's detail when it gave one.
 */
export function apiErrorState(error: unknown): { title: string; message: string } {
  const detail = apiErrorDetail(error);
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 404) return { title: "Not found.", message: detail ?? "The server has no record of this." };
  if (status === 401 || status === 403) return { title: "You do not have access to this.", message: detail ?? "Ask an administrator for access." };
  if (status !== undefined) return { title: "The server could not complete the request.", message: detail ?? `The server answered ${status}.` };
  return { title: "Could not reach the server.", message: detail ?? "" };
}

/** A 404 from a list endpoint means "no data here", not a failure; pages should show their empty state. */
export function isNotFound(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

/** Query failure for list/collection data: a 404 there means "nothing yet", not an error. */
export function isListFailure(q: { isError: boolean; error: unknown }): boolean {
  return q.isError && !isNotFound(q.error);
}
