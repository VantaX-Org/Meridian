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
  }
}

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
    (error) => {
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
