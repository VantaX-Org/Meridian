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
