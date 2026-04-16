/**
 * Meridian HQ — Admin API client.
 * Calls the Cloudflare Licence Worker admin endpoints server-side.
 * All calls include X-Admin-Secret header.
 */

const WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantFeatures {
  ask_meridian: boolean;
  export_reports: boolean;
  run_sync: boolean;
  field_mapping_self_service: boolean;
  max_users: number;
}

export interface LlmConfig {
  tier: 1 | 2 | 3;
  model: string;
  notes: string;
}

export interface Tenant {
  id: string;
  company_name: string;
  contact_email: string;
  licence_key_masked: string | null;
  tier: "starter" | "professional" | "enterprise";
  status: "active" | "suspended" | "trial" | "expired";
  expiry_date: string;
  enabled_modules: string[];
  enabled_menu_items: string[];
  features: TenantFeatures;
  llm_config: LlmConfig;
  machine_fingerprint: string | null;
  last_ping: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTenantInput {
  company_name: string;
  contact_email: string;
  tier?: string;
  expiry_date: string;
  status?: string;
  enabled_modules?: string[];
  enabled_menu_items?: string[];
  features?: Partial<TenantFeatures>;
  llm_config?: Partial<LlmConfig>;
}

export interface Rule {
  id: string;
  name: string;
  description: string | null;
  module: string;
  category: string;
  severity: string;
  enabled: boolean;
  conditions: RuleCondition[];
  thresholds: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export interface FieldMapping {
  id: string;
  tenant_id: string;
  module: string;
  standard_field: string;
  standard_label: string | null;
  customer_field: string | null;
  customer_label: string | null;
  data_type: string;
  is_mapped: boolean;
  notes: string | null;
  updated_at: string;
}

export interface AdminAnalytics {
  total: number;
  by_status: Record<string, number>;
  by_tier: Record<string, number>;
  expiring_soon: Array<{
    id: string;
    company_name: string;
    expiry_date: string;
    tier: string;
    status: string;
  }>;
  recent_activity: Array<{
    id: string;
    company_name: string;
    last_ping: string;
    status: string;
  }>;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function adminFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const resp = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Secret": ADMIN_SECRET,
      ...(options.headers || {}),
    },
    // Don't cache admin responses
    cache: "no-store",
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Admin API ${options.method || "GET"} ${path} failed (${resp.status}): ${body}`);
  }
  return resp.json() as Promise<T>;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getAnalytics(): Promise<AdminAnalytics> {
  return adminFetch<AdminAnalytics>("/api/admin/analytics");
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

export async function listTenants(params?: {
  status?: string;
  tier?: string;
  q?: string;
}): Promise<{ tenants: Tenant[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.tier) qs.set("tier", params.tier);
  if (params?.q) qs.set("q", params.q);
  const query = qs.toString() ? `?${qs}` : "";
  return adminFetch<{ tenants: Tenant[] }>(`/api/admin/tenants${query}`);
}

export async function createTenant(
  input: CreateTenantInput
): Promise<{ id: string; licence_key: string; company_name: string; tier: string; status: string }> {
  return adminFetch("/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getTenant(id: string): Promise<Tenant> {
  return adminFetch<Tenant>(`/api/admin/tenants/${id}`);
}

export async function updateTenant(
  id: string,
  updates: Partial<CreateTenantInput & { status: string }>
): Promise<Tenant> {
  return adminFetch<Tenant>(`/api/admin/tenants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteTenant(id: string): Promise<{ deleted: boolean }> {
  return adminFetch(`/api/admin/tenants/${id}`, { method: "DELETE" });
}

export async function regenerateKey(
  id: string
): Promise<{ licence_key: string; tenant_id: string }> {
  return adminFetch(`/api/admin/tenants/${id}/regenerate-key`, { method: "POST" });
}

export async function getTenantFieldMappings(
  tenantId: string,
  module?: string
): Promise<{ field_mappings: FieldMapping[] }> {
  const query = module ? `?module=${encodeURIComponent(module)}` : "";
  return adminFetch<{ field_mappings: FieldMapping[] }>(
    `/api/admin/tenants/${tenantId}/field-mappings${query}`
  );
}

export async function upsertTenantFieldMappings(
  tenantId: string,
  mappings: Array<{
    module: string;
    standard_field: string;
    standard_label?: string;
    customer_field?: string;
    customer_label?: string;
    data_type?: string;
    is_mapped?: boolean;
    notes?: string;
  }>
): Promise<{ upserted: number }> {
  return adminFetch(`/api/admin/tenants/${tenantId}/field-mappings`, {
    method: "PUT",
    body: JSON.stringify({ mappings }),
  });
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export async function listRules(params?: {
  category?: string;
  module?: string;
  severity?: string;
  enabled?: boolean;
  q?: string;
}): Promise<{ rules: Rule[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.module) qs.set("module", params.module);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.enabled !== undefined) qs.set("enabled", String(params.enabled));
  if (params?.q) qs.set("q", params.q);
  const query = qs.toString() ? `?${qs}` : "";
  return adminFetch<{ rules: Rule[]; total: number }>(`/api/admin/rules${query}`);
}

export async function createRule(
  input: Omit<Rule, "id" | "created_at" | "updated_at">
): Promise<Rule> {
  return adminFetch<Rule>("/api/admin/rules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getRule(id: string): Promise<Rule> {
  return adminFetch<Rule>(`/api/admin/rules/${id}`);
}

export async function updateRule(
  id: string,
  updates: Partial<Omit<Rule, "id" | "created_at" | "updated_at">>
): Promise<Rule> {
  return adminFetch<Rule>(`/api/admin/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteRule(id: string): Promise<{ deleted: boolean }> {
  return adminFetch(`/api/admin/rules/${id}`, { method: "DELETE" });
}

export async function bulkImportRules(
  rules: Array<Partial<Rule>>
): Promise<{ imported: number }> {
  return adminFetch("/api/admin/rules/import", {
    method: "POST",
    body: JSON.stringify({ rules }),
  });
}
