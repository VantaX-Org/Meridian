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

const TOKEN_KEY = "mn_auth_token";
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
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
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
          localStorage.removeItem(TOKEN_KEY);
          window.location.href = new URL("/sign-in", window.location.origin).href;
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
