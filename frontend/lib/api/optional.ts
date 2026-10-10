import { AxiosError } from "axios";

/** Resolve to null when the endpoint is not deployed (404/405/501), so the
 *  screen can show an empty state instead of an error. */
export async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    const status = err instanceof AxiosError ? err.response?.status : undefined;
    if (status === 404 || status === 405 || status === 501) return null;
    throw err;
  }
}

/** The server's own words for a failed request, else the transport error. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (typeof d === "string" ? d : (d as { msg?: string })?.msg ?? JSON.stringify(d))).join("; ");
    }
    if (detail && typeof detail === "object" && Array.isArray((detail as { errors?: unknown }).errors)) {
      return ((detail as { errors: unknown[] }).errors).map(String).join("; ");
    }
  }
  const text = err instanceof Error ? err.message : String(err ?? "");
  return text.trim() || "Something went wrong.";
}
