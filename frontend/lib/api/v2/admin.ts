/**
 * The Admin area's API: every verb the current interface's admin pages use, on the same /api/v1 endpoints, through the
 * v2 client so fixture mode (?fixture=1) answers them with no backend. Types come from the existing clients; nothing
 * here invents a field.
 */
import type { User, UserListResponse, UserStatus, HealthResponse, TenantSettings, ExceptionBilling, CostModel } from "@/types/api";
import type { ApiKey, ApiKeyCreated, CreateApiKeyBody } from "@/lib/api/api-keys";
import type { AuditListParams, AuditListResponse, AuditSummaryRow, LlmAuditResponse } from "@/lib/api/audit";
import type { FieldMapping, FieldMappingsListResponse } from "@/lib/api/field-mappings";
import type { LicenceManifest } from "@/lib/api/licence";
import type { AccessRequest, EffectivePermissions } from "@/lib/api/me";
import type { AlertChannel, AlertChannelCreate, AlertChannelUpdate } from "@/lib/api/notifications";
import type { Preferences, PreferencesPatch } from "@/lib/preferences";
import type {
  PurgeLogEntry, PurgeResult, RetentionPolicy, RetentionPreviewItem, RetentionResponse, TenantPurgeRequest,
} from "@/lib/api/retention";
import type { Grant, GrantInput, GrantPreview, Matrix, Pair, Role, RoleMatrix, RolesMatrix, ConvertResult } from "@/lib/api/roles";
import type { NotificationConfig, ScoringConfig, ScoringResponse } from "@/lib/api/settings";
import type { SsoConfig, SsoConfigInput, SsoTestResult } from "@/lib/api/sso";
import type { TriggerUpdateResult, UpdateProgress, UpdateStatus } from "@/lib/api/system-update";
import type { DoctorResponse } from "@/lib/api/admin-doctor";
import type { ReferenceList } from "@/lib/api/system-objects";
import type { BulkAction, BulkResponse, ImportPreview, ImportResult } from "@/lib/api/users";
import type { AlertThresholds, PlannerConfig } from "@/types/api";
import type { SyncProfile } from "@/types/api";
import type { DownloadScope } from "@/lib/api/system-objects";
import { fixtureActive } from "./fixture";
import { fixtureAction } from "./fixtures/runs";
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

const enc = encodeURIComponent;

export type { BulkAction, User, UserStatus, ApiKey, ApiKeyCreated, AuditListResponse, FieldMapping, LicenceManifest, AlertChannel, Role, Grant, Matrix, Preferences, PreferencesPatch };

/* ── Users ── */

export interface UserQuery { q?: string; status?: UserStatus; role?: string; system_id?: string }
export const listUsers = (q: UserQuery = {}): Promise<UserListResponse> => v2Get("/users", { ...q });
export const setUserActive = (id: string, is_active: boolean): Promise<User> => v2Send("PUT", `/users/${enc(id)}`, { is_active });
export const inviteUser = (body: { email: string; name?: string; grants: { role_key: string; system_id?: string | null; module?: string | null }[] }): Promise<{ id: string; email: string; role: string; status: string }> =>
  v2Send("POST", "/users/invite", body);
export const removeUser = (id: string): Promise<{ id: string; status: string }> => v2Send("DELETE", `/users/${enc(id)}`);
export const resendInvite = (id: string): Promise<{ id: string; invite_status: string; invite_expires_at: string }> => v2Send("POST", `/users/${enc(id)}/invite/resend`);
export const createInviteLink = (id: string): Promise<{ id: string; url: string; expires_at: string }> => v2Send("POST", `/users/${enc(id)}/invite/link`);
export const resetUserPassword = (id: string, send_email: boolean): Promise<{ id: string; must_change_password: boolean; emailed: boolean; link: string | null }> =>
  v2Send("POST", `/users/${enc(id)}/reset-password`, { send_email });
export const bulkUsers = (ids: string[], action: BulkAction): Promise<BulkResponse> => v2Send("POST", "/users/bulk", { ids, action });
export const previewUserImport = (csv: string): Promise<ImportPreview> => v2Send("POST", "/users/import/preview", { csv });
export const importUsers = (csv: string): Promise<ImportResult> => v2Send("POST", "/users/import", { csv });
export const listAccessRequests = (status?: AccessRequest["status"]): Promise<AccessRequest[]> => v2Get("/access-requests", { status });
export const decideAccessRequest = (id: string, body: { decision: "granted" | "declined"; reason?: string; role_key?: string }): Promise<AccessRequest> =>
  v2Send("POST", `/access-requests/${enc(id)}/decide`, body);

/* ── Roles, grants and the permission matrix ── */

export const listRoles = (): Promise<Role[]> => v2Get("/roles");
export const getRolesMatrix = (): Promise<RolesMatrix> => v2Get("/roles/matrix");
export const createRole = (body: { name: string; cloned_from: string; description?: string }): Promise<Role> => v2Send("POST", "/roles", body);
export const updateRole = (key: string, body: { name?: string; description?: string }): Promise<Role> => v2Send("PUT", `/roles/${enc(key)}`, body);
export const removeRole = (key: string): Promise<{ key: string; status: string }> => v2Send("DELETE", `/roles/${enc(key)}`);
export const getRolePermissions = (key: string): Promise<RoleMatrix> => v2Get(`/roles/${enc(key)}/permissions`);
export const putRolePermissions = (key: string, permissions: Pair[]): Promise<RoleMatrix> => v2Send("PUT", `/roles/${enc(key)}/permissions`, { permissions });
export const listGrants = (userId: string): Promise<Grant[]> => v2Get(`/users/${enc(userId)}/grants`);
export const addGrant = (userId: string, body: GrantInput): Promise<Grant> => v2Send("POST", `/users/${enc(userId)}/grants`, body);
export const removeGrant = (userId: string, grantId: string): Promise<{ id: string; status: string }> => v2Send("DELETE", `/users/${enc(userId)}/grants/${enc(grantId)}`);
export const convertObjectApprovals = (userId: string, confirm: boolean): Promise<ConvertResult> => v2Send("POST", `/users/${enc(userId)}/object-approvals/convert`, { confirm });
export const getUserEffective = (userId: string): Promise<EffectivePermissions> => v2Get(`/users/${enc(userId)}/effective`);
export const previewGrant = (userId: string, grant: { role_key: string; system_id?: string | null; module?: string | null }): Promise<GrantPreview> =>
  v2Get(`/users/${enc(userId)}/effective`, { with_grant: grant.role_key, system_id: grant.system_id, module: grant.module });

/* ── Single sign-on ── */

export const getSso = (): Promise<SsoConfig> => v2Get("/admin/sso");
export const saveSso = (input: SsoConfigInput): Promise<SsoConfig> => v2Send("PUT", "/admin/sso", input);
export const removeSso = (): Promise<SsoConfig> => v2Send("DELETE", "/admin/sso");
export const testSso = (issuer?: string): Promise<SsoTestResult> => v2Send("POST", "/admin/sso/test", issuer ? { issuer } : {});

/* ── API keys ── */

export const listApiKeys = (): Promise<ApiKey[]> => v2Get("/admin/api-keys");
export const createApiKey = (body: CreateApiKeyBody): Promise<ApiKeyCreated> => v2Send("POST", "/admin/api-keys", body);
export const revokeApiKey = (id: string): Promise<ApiKey> => v2Send("POST", `/admin/api-keys/${enc(id)}/revoke`);
export const deleteApiKey = (id: string): Promise<{ id: string; status: string }> => v2Send("DELETE", `/admin/api-keys/${enc(id)}`);

/* ── Licence, billing, platform version ── */

export const getLicence = (): Promise<LicenceManifest> => v2Get("/licence");
export const validateLicence = (): Promise<LicenceManifest> => v2Send("POST", "/licence/validate");
export type BillingPeriod = ExceptionBilling & { currency: string };
export const getBilling = (period: string): Promise<BillingPeriod> => v2Get("/exceptions/billing", { period });
export const getUpdateStatus = (): Promise<UpdateStatus> => v2Get("/system/update-status");
export const getUpdateProgress = (): Promise<UpdateProgress> => v2Get("/system/update/progress");
export async function triggerUpdate(): Promise<TriggerUpdateResult> {
  try {
    return await v2Send<TriggerUpdateResult>("POST", "/system/update/trigger");
  } catch (err: unknown) {
    // 409 means one is already running: an outcome, not a failure.
    if ((err as { response?: { status?: number } })?.response?.status === 409) return { status: "already_running" };
    throw err;
  }
}
export const getDoctor = (): Promise<DoctorResponse> => v2Get("/admin/doctor");
/** GET /health lives at the server root, not under /api/v1. */
export async function getHealth(): Promise<HealthResponse> {
  if (fixtureActive()) return v2Get<HealthResponse>("/health");
  const { default: client } = await import("@/lib/api/client");
  const { data } = await client.get<HealthResponse>("/health");
  return data;
}

/* ── Tenant settings ── */

export const getTenantSettings = (): Promise<TenantSettings> => v2Get("/settings");
export const getScoring = (): Promise<ScoringResponse> => v2Get("/settings/scoring");
export const putScoring = (config: ScoringConfig): Promise<{ status: string }> => v2Send("PUT", "/settings/scoring", config);
export const savePlanner = (config: PlannerConfig): Promise<{ status: string }> => v2Send("POST", "/settings/planner", config);
export const getCostModel = async (): Promise<CostModel> => (await v2Get<{ effective: CostModel }>("/settings/cost-model")).effective;
export const putCostModel = (model: CostModel): Promise<{ status: string }> => v2Send("PUT", "/settings/cost-model", model);
export const getCostFeatures = async (): Promise<{ feature: string; l1: string | null }[]> => (await v2Get<{ features: { feature: string; l1: string | null }[] }>("/settings/cost-model/features")).features;
export const saveAlertThresholds = (t: AlertThresholds): Promise<{ status: string }> => v2Send("PATCH", "/settings/alert-thresholds", t);
export const saveDefaultDigest = (c: NotificationConfig): Promise<{ status: string }> => v2Send("POST", "/settings/notifications", c);

export const getRetention = (): Promise<RetentionResponse> => v2Get("/settings/retention");
export const putRetention = (policy: RetentionPolicy): Promise<RetentionResponse> => v2Send("PUT", "/settings/retention", policy);
export const getRetentionPreview = async (): Promise<RetentionPreviewItem[]> => (await v2Get<{ items: RetentionPreviewItem[] }>("/settings/retention/preview")).items;
export const previewRetentionDraft = async (policy: RetentionPolicy): Promise<RetentionPreviewItem[]> => (await v2Send<{ items: RetentionPreviewItem[] }>("POST", "/settings/retention/preview", policy)).items;
export const getPurgeLog = async (limit = 50): Promise<PurgeLogEntry[]> => (await v2Get<{ items: PurgeLogEntry[] }>("/settings/purge-log", { limit })).items;
export const purgeVersion = (id: string, confirm: string): Promise<PurgeResult> => v2Send("DELETE", `/versions/${enc(id)}`, { confirm });
export const requestTenantPurge = (): Promise<TenantPurgeRequest> => v2Send("POST", "/admin/purge-tenant", {});
/** Step two of the purge: the API answers with the deletion certificate (a PDF) and the browser saves it. */
export async function executeTenantPurge(token: string): Promise<string> {
  if (fixtureActive()) {
    await v2Send("POST", "/admin/purge-tenant", { token });
    return v2Download("/admin/purge-tenant/certificate", {}, "deletion-certificate.pdf");
  }
  const { uploadApiClient } = await import("@/lib/api/client");
  try {
    const res = await uploadApiClient.post<Blob>("/api/v1/admin/purge-tenant", { token }, { responseType: "blob" });
    const url = window.URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = "deletion-certificate.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return "deletion-certificate.pdf";
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      try {
        const detail = (JSON.parse(await data.text()) as { detail?: unknown }).detail;
        const message = typeof detail === "string" ? detail : (detail as { message?: unknown } | undefined)?.message;
        if (typeof message === "string") throw new Error(message);
      } catch (inner) {
        if (inner instanceof Error && !(inner instanceof SyntaxError)) throw inner;
      }
    }
    throw err;
  }
}

/* ── Field mappings ── */

export const listFieldMappings = (q: { module?: string; is_mapped?: boolean; search?: string } = {}): Promise<FieldMappingsListResponse> => v2Get("/field-mappings", q);
export const updateFieldMapping = (id: string, body: { customer_field?: string; customer_label?: string; data_type?: string; is_mapped?: boolean; notes?: string }): Promise<FieldMapping> =>
  v2Send("PUT", `/field-mappings/${enc(id)}`, body);
export const resetFieldMappings = (module?: string): Promise<{ reset_count: number; module: string }> => v2Send("POST", "/field-mappings/reset", undefined, { module });

/* ── Reference data ── */

export const getReferenceLists = (systemId: string): Promise<ReferenceList[]> => v2Get(`/systems/${enc(systemId)}/reference`);
/** The CSV goes as the raw body (text/csv): a JSON content type would quote it. */
export async function uploadReference(systemId: string, kind: "postal-codes" | "bic", csv: string): Promise<ReferenceList> {
  const path = `/systems/${enc(systemId)}/reference/${kind}`;
  if (fixtureActive()) return v2Send<ReferenceList>("POST", path, csv);
  const { default: client } = await import("@/lib/api/client");
  const { data } = await client.post<ReferenceList>(`/api/v1${path}`, csv, { headers: { "Content-Type": "text/csv" } });
  return data;
}

/* ── Audit ── */

export const listAudit = (q: AuditListParams = {}): Promise<AuditListResponse> => v2Get("/audit", q as Record<string, string | number>);
export const getAuditSummary = (): Promise<{ summary: AuditSummaryRow[]; total?: number }> => v2Get("/audit/summary");
export const getAiAudit = (q: { limit?: number; offset?: number } = {}): Promise<LlmAuditResponse> => v2Get("/audit/llm", q);
export const exportAudit = (format: "csv" | "xlsx", q: AuditListParams = {}): Promise<string> =>
  v2Download("/audit/export", { format, ...(q as Record<string, string | number>) }, `audit_log.${format}`);

/* ── Alert channels ── */

export const listChannels = async (): Promise<AlertChannel[]> => (await v2Get<{ channels: AlertChannel[] }>("/alert-channels")).channels;
export const createChannel = (body: AlertChannelCreate): Promise<AlertChannel> => v2Send("POST", "/alert-channels", body);
export const updateChannel = (id: string, body: AlertChannelUpdate): Promise<AlertChannel> => v2Send("PUT", `/alert-channels/${enc(id)}`, body);
export const deleteChannel = (id: string): Promise<void> => v2Send("DELETE", `/alert-channels/${enc(id)}`);
export const testChannel = (id: string): Promise<{ delivered: boolean }> => v2Send("POST", `/alert-channels/${enc(id)}/test`);

/* ── The signed-in user's own preferences and notifications ── */

export const getMyPreferences = (): Promise<Preferences> => v2Get("/me/preferences");
export const patchMyPreferences = (patch: PreferencesPatch): Promise<Preferences> => v2Send("PATCH", "/me/preferences", patch);
export const sendTestNotification = (): Promise<{ email: "sent" | "no_backend" | "failed" | "sent_unrecorded"; in_app: boolean }> => v2Send("POST", "/me/notifications/test");

/* ── Runs and jobs: start things, and schedule them ── */

export type { SyncProfile, DownloadScope };

/** POST /systems/{id}/downloads: extract the chosen objects within a scope, optionally analysing straight after. */
export async function startExtraction(systemId: string, objects: string[], analyse: boolean, scope: DownloadScope, delta = false): Promise<{ job_id: string; status: string }> {
  if (fixtureActive()) return fixtureAction("extract", { id: systemId, objects, analyse, scope, delta }) as { job_id: string; status: string };
  const { startDownload } = await import("@/lib/api/system-objects");
  return startDownload(systemId, { objects, scope, analyse, ...(delta ? { delta: true } : {}) });
}

export const listProfiles = (systemId: string): Promise<SyncProfile[]> => v2Get(`/systems/${enc(systemId)}/profiles`);
export const createProfile = (systemId: string, body: { system_id: string; domain: string; tables: string[]; schedule_cron: string; active: boolean; extraction_mode: "full" | "delta" }): Promise<SyncProfile> =>
  v2Send("POST", `/systems/${enc(systemId)}/profiles`, body);
export const updateProfile = (systemId: string, id: string, body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" }): Promise<SyncProfile> =>
  v2Send("PATCH", `/systems/${enc(systemId)}/profiles/${enc(id)}`, body);
export const deleteProfile = (systemId: string, id: string): Promise<void> => v2Send("DELETE", `/systems/${enc(systemId)}/profiles/${enc(id)}`);
