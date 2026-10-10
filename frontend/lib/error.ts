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

/** `apiErrorDetail(error) ?? "Could not reach the server."` as one call. */
export function apiErrorMessage(error: unknown): string {
  return apiErrorDetail(error) ?? "Could not reach the server.";
}

/** A 404 from a list endpoint means "no data here", not a failure; pages should show their empty state. */
export function isNotFound(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}
