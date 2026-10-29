/**
 * Enterprise readiness reads and writes: the tenant's theme, the status page, the support diagnostics, the compliance
 * settings and SCIM provisioning. Every call goes through the v2 client, so fixture mode (`?fixture=1`) answers it from
 * lib/api/v2/fixtures/enterprise.ts with no backend. The shapes are the backend's (step 8 brief); nothing is invented
 * beyond what the brief names, and the two assumptions are marked where they are made.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

/* ── Theme ── */

/** The tenant's look. `accent` is "#rrggbb"; null fields mean Meridian's own. */
export interface TenantTheme {
  logo_url: string | null;
  product_name: string | null;
  accent: string | null;
}

/** GET /theme: public, so the sign-in page can show the tenant's logo and name before anyone signs in. */
export const getTheme = (): Promise<TenantTheme> => v2Get("/theme");
/** GET /settings/theme: the same document for the Appearance form. */
export const getThemeSettings = (): Promise<TenantTheme> => v2Get("/settings/theme");
/**
 * PUT /settings/theme. The logo travels as a data URL in `logo_url` (assumption: the brief names no upload endpoint);
 * a refusal is `{detail}` and arrives as the error's sentence.
 */
export const putThemeSettings = (body: TenantTheme): Promise<TenantTheme> => v2Send("PUT", "/settings/theme", body);

/* ── Status page ── */

export type ComponentStatus = "ok" | "degraded" | "down";
export interface StatusComponent {
  name: string;
  status: ComponentStatus;
  detail: string | null;
  measured_at: string;
}
export interface StatusIncident {
  reference: string;
  first_seen: string;
  last_seen: string;
  count: number;
  path: string | null;
}
export interface StatusPage {
  components: StatusComponent[];
  incidents: StatusIncident[];
  maintenance: { from: string; to: string; note: string } | null;
  uptime_30d_pct: number | null;
  /** Health probes, oldest first; the page folds them into one cell per day. */
  samples: { at: string; ok: boolean }[];
}

/** GET /status/page: readable signed out. */
export const getStatusPage = (): Promise<StatusPage> => v2Get("/status/page");

/* ── Diagnostics ── */

/** GET /support/diagnostics: the JSON summary support asks for. Its keys are the backend's; the panel shows them as they come. */
export type DiagnosticsSummary = Record<string, unknown>;
export const getDiagnostics = (): Promise<DiagnosticsSummary> => v2Get("/support/diagnostics");
/** GET /support/diagnostics.zip, saved by the browser. Returns the file name. */
export const downloadDiagnostics = (): Promise<string> => v2Download("/support/diagnostics.zip", undefined, "meridian-diagnostics.zip");

/* ── Compliance ── */

export interface ComplianceSettings {
  residency: { host: string; region: string | null };
  retention: { family: string; days: number }[];
  encryption_at_rest: boolean | null;
  last_backup_at: string | null;
}
export const getCompliance = (): Promise<ComplianceSettings> => v2Get("/settings/compliance");
/** PUT /settings/compliance with the whole document; only `retention` is editable on the screen. */
export const putCompliance = (body: ComplianceSettings): Promise<ComplianceSettings> => v2Send("PUT", "/settings/compliance", body);

/* ── SCIM ── */

export interface ScimToken {
  created_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  /** Present once, in the answer that created it. */
  token?: string;
}
export interface ScimGroupRoles {
  map: { group: string; role: string }[];
}

export const getScimToken = (): Promise<ScimToken> => v2Get("/admin/scim/token");
/** POST /admin/scim/token creates a token, or rotates the one there is (the old one stops at once). */
export const createScimToken = (): Promise<ScimToken> => v2Send("POST", "/admin/scim/token");
/**
 * Revokes the token. Assumption: DELETE /admin/scim/token (the brief names GET and POST only); the answer is the
 * token's state with `revoked: true`.
 */
export const revokeScimToken = (): Promise<ScimToken> => v2Send("DELETE", "/admin/scim/token");
export const getScimGroupRoles = (): Promise<ScimGroupRoles> => v2Get("/admin/scim/group-roles");
export const putScimGroupRoles = (body: ScimGroupRoles): Promise<ScimGroupRoles> => v2Send("PUT", "/admin/scim/group-roles", body);

/** The SCIM 2.0 base URL an identity provider is given: this deployment's origin and the API's SCIM root. */
export function scimBaseUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/v1/scim/v2`;
}

/** Whether a user row was provisioned by SCIM: it carries an external id. */
export function provisionedByScim(user: object): boolean {
  const u = user as { external_id?: unknown; externalId?: unknown; scim?: unknown };
  return Boolean((typeof u.external_id === "string" && u.external_id) || (typeof u.externalId === "string" && u.externalId) || u.scim === true || (typeof u.scim === "object" && u.scim !== null));
}
