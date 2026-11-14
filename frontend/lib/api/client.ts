import axios, { AxiosInstance } from "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Whether a scoped 403 on this request opens the request-access Dialog.
     * Defaults to true for non-GET requests (a user clicked something) and
     * false for GET (polling, prefetch). Set it to override, e.g. `false` on a
     * background POST, `true` on a user-triggered download.
     */
    requestAccess?: boolean;
    /** Set on the one retry of an idempotent GET, so it is never retried twice. */
    retried?: boolean;
  }
}

/** Statuses the Next.js proxy answers with when the API connection drops or the API is restarting. */
const PROXY_STATUSES = new Set([502, 503, 504]);
/** Socket-level failures with no response: the connection was reset or refused mid-request. */
const NETWORK_CODES = new Set(["ECONNRESET", "ERR_NETWORK", "ECONNREFUSED", "EPIPE"]);

/**
 * Whether a failed request is retried once: only a GET (idempotent), only once, and only for a dropped connection
 * or a proxy-side failure (502, 503, 504, or a 500 whose body is not the API's JSON error). A 500 with a JSON body
 * is a real API error and is never retried; neither is a timeout or any POST, PUT, PATCH or DELETE.
 */
export function isRetryable(error: { code?: string; config?: { method?: string; retried?: boolean }; response?: { status: number; data?: unknown } }): boolean {
  const config = error.config;
  if (!config || config.retried) return false;
  if ((config.method ?? "get").toLowerCase() !== "get") return false;
  const res = error.response;
  if (!res) return NETWORK_CODES.has(error.code ?? "");
  if (PROXY_STATUSES.has(res.status)) return true;
  // The proxy's own 500 ("Failed to proxy ... ECONNRESET") has a plain-text body; the API's errors are JSON objects.
  return res.status === 500 && (res.data == null || typeof res.data !== "object");
}

/** Pause before the retry, long enough for a reset keep-alive socket to be replaced. */
const RETRY_DELAY_MS = 300;

/** What a scoped 403 asked for (rbac.md §3.3). `resource` is null for in-handler `require_scope` checks; `action` may be a legacy action name. */
export interface AccessDenied { resource: string | null; action: string }

const expiredListeners = new Set<() => boolean>();

/**
 * Subscribe to an expired session (a 401 outside the login call); returns the unsubscribe. A listener that returns
 * true has handled it (the page holds unsaved edits and offers sign-in in a new tab), so the page is not sent away.
 */
export function onSessionExpired(listener: () => boolean): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

const deniedListeners = new Set<(denied: AccessDenied) => void>();

/** Subscribe to user-initiated scoped 403s; returns the unsubscribe. The (app) PermissionsProvider is the only listener, so public auth routes never get the Dialog. */
export function onAccessDenied(listener: (denied: AccessDenied) => void): () => void {
  deniedListeners.add(listener);
  return () => deniedListeners.delete(listener);
}

/** The nested body `{"detail": {"detail": "forbidden", resource, action, request_access: true}}`, else null. */
export function accessDeniedFrom(status: number | undefined, data: unknown): AccessDenied | null {
  if (status !== 403 || !data || typeof data !== "object") return null;
  const inner = (data as { detail?: unknown }).detail;
  if (!inner || typeof inner !== "object") return null;
  const d = inner as { request_access?: unknown; resource?: unknown; action?: unknown };
  if (d.request_access !== true || typeof d.action !== "string") return null;
  return { resource: typeof d.resource === "string" ? d.resource : null, action: d.action };
}

/**
 * The licence middleware's lock errors (api/middleware/licence.py): every gated route answers one of these, so the
 * app cannot work and goes to /licence-error, which says why. Before, each page read the lock as its own failure
 * ("Could not reach the server.", "You do not have access to this.") and the nav emptied with no word of the licence.
 * `feature_not_licenced` is not a lock: the rest of the app works, so the page handles it.
 */
const LICENCE_LOCKS = new Set(["licence_invalid", "licence_unverified", "licence_server_cutoff"]);

/** The lock a response carries (`{"error": "licence_unverified", ...}` on a 402 or 403), else null. */
export function licenceLockFrom(status: number | undefined, data: unknown): string | null {
  if ((status !== 402 && status !== 403) || !data || typeof data !== "object") return null;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" && LICENCE_LOCKS.has(code) ? code : null;
}

/**
 * The browser's session is an httponly cookie the page cannot read, so there is no token to keep. Before that
 * change the JWT sat in localStorage under this key; it is only read once, to move such a session over (see
 * context/auth-context.tsx), and removed.
 */
export const LEGACY_TOKEN_KEY = "mn_auth_token";
const CSRF_COOKIE = "mn_csrf";
const SAFE_METHODS = new Set(["get", "head", "options"]);

/** The CSRF token the API set as a readable cookie at sign-in, echoed in X-CSRF-Token on every mutating request. */
function csrfToken(): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : null;
}

/** Signed-in marker for proxy.ts: the page-readable stand-in for the httponly session cookie. */
export function setSessionMarker(on: boolean): void {
  document.cookie = on
    ? "mn_session=1; Path=/; SameSite=Lax; Max-Age=2592000"
    : "mn_session=; Path=/; SameSite=Lax; Max-Age=0";
}

export function hasSessionMarker(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith("mn_session="));
}

/** Drop everything the page keeps of a session: the marker and any pre-cookie token. */
export function clearBrowserSession(): void {
  setSessionMarker(false);
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // storage blocked: nothing was kept there
  }
}

const PER_PAGE_CAP = 100;
let warnedPerPageCap = false;

// Attach auth + error interceptors to an axios instance
function instrument(client: AxiosInstance): AxiosInstance {
  client.interceptors.request.use((config) => {
    // ponytail: clamp here so no caller can regress past the backend's own
    // per_page cap (api/routes/*.py: le=100) instead of fixing it per call site.
    const perPage = config.params?.per_page;
    if (typeof perPage === "number" && perPage > PER_PAGE_CAP) {
      config.params.per_page = PER_PAGE_CAP;
      if (process.env.NODE_ENV !== "production" && !warnedPerPageCap) {
        warnedPerPageCap = true;
         
        console.warn(`per_page ${perPage} clamped to ${PER_PAGE_CAP}`);
      }
    }
    if (typeof window === "undefined") return config;
    // The session cookie rides along by itself (same origin); a mutating request also proves it came from this page.
    if (!SAFE_METHODS.has((config.method ?? "get").toLowerCase())) {
      const csrf = csrfToken();
      if (csrf) config.headers["X-CSRF-Token"] = csrf;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (isRetryable(error)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return client.request({ ...error.config, retried: true });
      }
      if (typeof window !== "undefined" && error.response) {
        // a 401 from the login call means wrong credentials, not an expired session: let the form show it
        if (error.response.status === 401 && !String(error.config?.url ?? "").endsWith("/api/v1/auth/login")) {
          if ([...expiredListeners].some((l) => l())) return Promise.reject(error);
          clearBrowserSession();
          const back = window.location.pathname + window.location.search;
          window.location.href = new URL(`/sign-in?next=${encodeURIComponent(back)}`, window.location.origin).href;
          return Promise.reject(error);
        }
        const lock = licenceLockFrom(error.response.status, error.response.data);
        if (lock && window.location.pathname !== "/licence-error") {
          window.location.href = new URL(`/licence-error?reason=${lock}`, window.location.origin).href;
          return Promise.reject(error);
        }
        const denied = accessDeniedFrom(error.response.status, error.response.data);
        const config = error.config ?? {};
        const userInitiated = config.requestAccess ?? (config.method ?? "get").toLowerCase() !== "get";
        if (denied && userInitiated) deniedListeners.forEach((l) => l(denied));
        // Don't redirect on 402 - let components handle missing features gracefully
      }
      return Promise.reject(error);
    }
  );
  return client;
}

// Short timeout (30s) — snappy UI endpoints
const apiClient = instrument(axios.create({
  baseURL: "",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
}));

// Long timeout (180s) — LLM-dependent endpoints (NLP, AI enrichment, agent runs)
export const longApiClient = instrument(axios.create({
  baseURL: "",
  timeout: 180_000,
  headers: { "Content-Type": "application/json" },
}));

// Very long timeout (300s) — uploads, exports, PDF generation
export const uploadApiClient = instrument(axios.create({
  baseURL: "",
  timeout: 300_000,
  headers: { "Content-Type": "application/json" },
}));

export default apiClient;
