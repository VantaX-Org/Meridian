import apiClient from "@/lib/api/client";

export interface ClientErrorContext {
  /** Next.js error id, when the framework supplies one. */
  digest?: string;
  pathname?: string;
}

export interface ClientErrorPayload {
  digest: string;
  message: string;
  stack?: string;
  pathname: string;
  user_agent: string;
  time: string;
}

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const reported = new Set<string>();

function fingerprint(message: string, stack: string | undefined): string {
  let h = 0;
  const src = `${message}\n${stack ?? ""}`;
  for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(16)}`;
}

/** The reference id shown to the user and sent to the server: the framework's id when present, else a fingerprint. */
export function clientErrorId(err: unknown, framework?: string): string {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
  return framework || (e as Error & { digest?: string }).digest || fingerprint(e.message, e.stack);
}

/** Test hook: forget which errors were already sent this session. */
export function resetClientErrorGuard(): void {
  reported.clear();
}

/**
 * Send a render or runtime error to the customer's own API (never a third party).
 * One report per digest per page session; failures are swallowed so error handling
 * can never raise a second error.
 */
export function reportClientError(err: unknown, ctx: ClientErrorContext = {}): void {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
    const id = clientErrorId(e, ctx.digest);
    if (reported.has(id)) return;
    reported.add(id);
    const payload: ClientErrorPayload = {
      digest: id,
      message: (e.message || "Unknown error").slice(0, MAX_MESSAGE),
      stack: e.stack?.slice(0, MAX_STACK),
      pathname: ctx.pathname ?? (typeof window !== "undefined" ? window.location.pathname : ""),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      time: new Date().toISOString(),
    };
    // Forget the digest on failure so a later occurrence can reach the log once the API is back.
    void apiClient.post("/api/v1/client-errors", payload).catch(() => { reported.delete(id); });
  } catch {
    /* reporting must never throw */
  }
}

const CHUNK_ERROR = /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_KEY = "meridian.chunk-reload-at";
const RELOAD_GAP_MS = 60_000;

/**
 * After a deploy an open tab still asks for the old build's chunks, which are gone. On that error, reload once
 * so the tab picks up the new build. A second chunk error within a minute shows the error page instead of looping.
 * Returns true when a reload was started.
 */
export function reloadOnChunkError(err: unknown): boolean {
  try {
    const e = err as { name?: string; message?: string } | null;
    if (!e || !CHUNK_ERROR.test(`${e.name ?? ""} ${e.message ?? ""}`)) return false;
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false; // no sessionStorage (private mode, blocked): never reload without the loop guard
  }
}
