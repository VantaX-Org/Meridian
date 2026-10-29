/**
 * Enterprise readiness reads and writes: the tenant's theme, the status page, the support diagnostics, the compliance
 * statement and SCIM provisioning. Every shape here is the backend's, read from its routes and their tests
 * (api/routes/theme.py, status_page.py, diagnostics.py, compliance.py, scim_admin.py); nothing is added to them. A
 * value the server sends as null stays null, and the screens show a dash for it. Every call goes through the v2
 * client, so fixture mode (`?fixture=1`) answers it from lib/api/v2/fixtures/enterprise.ts in the same shapes.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

/* ── Theme (api/routes/theme.py) ── */

/** GET /theme: public, so the sign-in page can show the tenant's logo and name before anyone signs in. */
export interface PublicTheme {
  /** The tenant's product name, or "Meridian". */
  product_name: string;
  /** "#RRGGBB", checked at 4.5:1 on white; the product's own accent when the tenant set none. */
  accent: string;
  /** "#RRGGBB", checked at 4.5:1 on the dark ground; derived from `accent` when the tenant set none. */
  accent_dark: string;
  /** Same-origin URL of the logo (`/api/v1/theme/logo?v=...`), or null. */
  logo_url: string | null;
  /** Whether the tenant set a name, an accent or a logo. */
  customised: boolean;
}

/** GET /settings/theme and the answer of every theme write: what the tenant set, null where it set nothing. */
export interface ThemeSettings {
  product_name_override: string | null;
  accent: string | null;
  accent_dark: string | null;
  logo_url: string | null;
  logo_content_type: string | null;
  /** The server's contrast ratios: the accent on white, the dark accent on the dark ground. */
  contrast: { on_white: number | null; on_dark: number | null };
  updated_at: string | null;
}

/** PUT /settings/theme. `logo_url` is null to remove the logo, or the current value to keep it; a logo is uploaded. */
export interface ThemeInput {
  product_name_override: string | null;
  accent: string | null;
  accent_dark: string | null;
  logo_url: string | null;
}

export const getTheme = (): Promise<PublicTheme> => v2Get("/theme");
export const getThemeSettings = (): Promise<ThemeSettings> => v2Get("/settings/theme");
/** A refusal (an accent below 4.5:1, a name too long) is `{detail}` and arrives as the error's sentence. */
export const putThemeSettings = (body: ThemeInput): Promise<ThemeSettings> => v2Send("PUT", "/settings/theme", body);

/** The logo the server takes: PNG or SVG, 512 KB at most (api/services/theme.py LOGO_MAX_BYTES). */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/svg+xml"] as const;

/** POST /settings/theme/logo, multipart with one `file`. The server reads the type from the bytes. */
export function uploadThemeLogo(file: File): Promise<ThemeSettings> {
  const form = new FormData();
  form.append("file", file);
  return v2Send("POST", "/settings/theme/logo", form);
}

/* ── Status page (api/routes/status_page.py, api/services/health_probe.py) ── */

/** The platform as a whole: an outage when a core component (API, database, cache, workers) is down. */
export type OverallStatus = "operational" | "degraded" | "outage";
export type ComponentStatus = "up" | "degraded" | "down" | "not_configured";

/** One live probe. */
export interface StatusComponent {
  id: string;
  label: string;
  status: ComponentStatus;
  latency_ms: number | null;
  detail: string | null;
  data: Record<string, unknown>;
}

/** Server errors of the last 24 hours, grouped by their reference; `areas` are "METHOD /api/v1/<area>", never a key. */
export interface StatusIncident {
  reference: string;
  count: number;
  first_seen: string;
  last_seen: string;
  areas: string[];
}

/** A planned maintenance window that has not ended. */
export interface MaintenanceWindow {
  id?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  detail: string | null;
  in_progress: boolean;
}

/** Health samples of the last `days` days, every `sample_minutes`. A percentage is null when nothing was sampled. */
export interface Uptime {
  days: number;
  sample_minutes: number;
  overall_pct: number | null;
  slots: number;
  components: { id: string; label: string; samples: number; uptime_pct: number | null }[];
  /** One entry per day that has samples, oldest first; `date` is the UTC day, YYYY-MM-DD. */
  by_day: { date: string; slots: number; uptime_pct: number | null }[];
}

export interface StatusPage {
  status: OverallStatus;
  generated_at: string;
  components: StatusComponent[];
  incidents: StatusIncident[];
  maintenance: MaintenanceWindow[];
  uptime: Uptime;
}

/** GET /status/page: readable signed out. */
export const getStatusPage = (): Promise<StatusPage> => v2Get("/status/page");

/* ── Diagnostics (api/routes/diagnostics.py) ── */

/** GET /support/diagnostics: the summary part of the bundle. The panel shows it as the server sends it. */
export type DiagnosticsSummary = Record<string, unknown>;
export const getDiagnostics = (): Promise<DiagnosticsSummary> => v2Get("/support/diagnostics");
/** GET /support/diagnostics.zip, saved by the browser. Returns the file name. */
export const downloadDiagnostics = (): Promise<string> => v2Download("/support/diagnostics.zip", undefined, "meridian-diagnostics.zip");

/* ── Compliance (api/routes/compliance.py) ── */

export interface RetentionFamily {
  family: string;
  /** The server's English name of the family. */
  label: string;
  /** Null when that data is kept for ever. */
  days: number | null;
  configurable: boolean;
}

export interface ComplianceStatement {
  generated_at: string;
  data_residency: {
    deployment: string;
    database_host: string | null;
    object_storage_host: string | null;
    llm_provider: string | null;
    llm_in_deployment: boolean | null;
  };
  retention: {
    families: RetentionFamily[];
    keep_baseline: boolean;
    keep_latest_per_system: number;
    enforcement: { flag_enabled: boolean; dry_run_until: string | null; enforced: boolean };
  };
  /** Infrastructure facts are null when the deployment does not declare them. */
  encryption_at_rest: { database_volume: boolean | null; object_storage: boolean | null; sap_credentials: boolean; llm_api_keys: boolean };
  backup: { at: string; migration_head: string | null; database_only: boolean | null; env_encrypted: boolean | null } | null;
}

/** The retention days PUT /settings/compliance takes; a field left out keeps its value, null keeps the data for ever. */
export interface RetentionInput {
  versions_days?: number | null;
  reports_days?: number | null;
  audit_days?: number | null;
}

/** Which input field each configurable family is stored under. */
export const RETENTION_FIELD: Record<string, keyof RetentionInput> = { analysis_versions: "versions_days", reports: "reports_days", audit_log: "audit_days" };
/** The bounds of the retention policy (api/services/retention.py RetentionPolicy). */
export const RETENTION_MIN: Record<keyof RetentionInput, number> = { versions_days: 1, reports_days: 1, audit_days: 30 };
export const RETENTION_MAX = 3650;

export const getCompliance = (): Promise<ComplianceStatement> => v2Get("/settings/compliance");
export const putCompliance = (retention: RetentionInput): Promise<ComplianceStatement> => v2Send("PUT", "/settings/compliance", { retention });

/* ── SCIM (api/routes/scim_admin.py, manage_system) ── */

export interface ScimTokenStatus {
  configured: boolean;
  /** "mscim_" with the first and last characters of the token, never the token. */
  token_prefix: string | null;
  created_at: string | null;
  last_used_at: string | null;
  /** The SCIM 2.0 base URL an identity provider is given, as the server sees itself. */
  base_url: string;
  /** Present once, in the answer that created or rotated it. */
  token?: string;
}

export interface ScimMapping {
  group: string;
  role: string;
  role_name: string;
  /** Whether the identity provider has sent a group of that name yet. */
  group_exists: boolean;
  members: number;
}
export interface ScimMappings {
  mappings: ScimMapping[];
  /** After a save: how many people were re-synced to the new map. */
  resynced_users?: number | null;
}

export const getScimToken = (): Promise<ScimTokenStatus> => v2Get("/admin/scim/token");
/** POST /admin/scim/token: creates the first token or rotates the live one (the old one stops at once). */
export const rotateScimToken = (): Promise<ScimTokenStatus> => v2Send("POST", "/admin/scim/token", { action: "rotate" });
/** POST /admin/scim/token with `revoke`: the live token stops; the answer is the state without one. */
export const revokeScimToken = (): Promise<ScimTokenStatus> => v2Send("POST", "/admin/scim/token", { action: "revoke" });
export const getScimGroupRoles = (): Promise<ScimMappings> => v2Get("/admin/scim/group-roles");
/** PUT replaces the map; everyone in a SCIM group is re-synced at once. */
export const putScimGroupRoles = (mappings: { group: string; role: string }[]): Promise<ScimMappings> => v2Send("PUT", "/admin/scim/group-roles", { mappings });
