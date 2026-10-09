import { isAxiosError } from "axios";

/**
 * The API's own detail message for a failed request, or null when there isn't
 * one (network failure, non-API error, etc). Callers show this — never the
 * raw Error/AxiosError message — falling back to a generic sentence.
 */
export function apiErrorDetail(error: unknown): string | null {
  return isAxiosError<{ detail?: unknown }>(error) && typeof error.response?.data?.detail === "string"
    ? error.response.data.detail
    : null;
}

/** `apiErrorDetail(error) ?? "Could not reach the server."` as one call. */
export function apiErrorMessage(error: unknown): string {
  return apiErrorDetail(error) ?? "Could not reach the server.";
}
