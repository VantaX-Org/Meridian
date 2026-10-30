/**
 * Fixture answers for the Admin area, preferences, reports, schedules and migration waves (`?fixture=1`). The state is
 * kept in memory, so a write in the screen shows in the next read; `resetAdminFixture()` restores the starting point
 * for tests. Names, numbers and dates are invented for the demo tenant and are stable, so screenshots repeat.
 */
import type { User, UserGrant } from "@/types/api";
import type { ApiKey } from "@/lib/api/api-keys";
import type { AuditEntry } from "@/lib/api/audit";
import type { FieldMapping } from "@/lib/api/field-mappings";
import type { AlertChannel } from "@/lib/api/notifications";
import type { Role, Matrix } from "@/lib/api/roles";
import type { CatalogueEntry, ReportFile, ReportSchedule, ReportScheduleInput } from "@/lib/api/reports";
import type { MigrationWave } from "@/types/api";
import type { Preferences } from "@/lib/preferences";

interface Profile { id: string; system_id: string; domain: string; tables: string[]; schedule_cron: string | null; active: boolean; last_run_at: string | null; next_run_at: string | null; extraction_mode: "full" | "delta" }

export const NONE_ADMIN = Symbol("no-admin-fixture");

class AdminNotFound extends Error {
  status = 404;
  constructor(what: string) {
    super(`No fixture for ${what}`);
  }
}
class AdminRefused extends Error {
  response: { status: number; data: { detail: string } };
  constructor(status: number, detail: string) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}

const NOW = "2026-10-20T08:00:00Z";
const ago = (days: number, hour = 8): string => {
  const d = new Date(Date.parse(NOW) - days * 86_400_000);
  d.setUTCHours(hour, 12, 0, 0);
  return d.toISOString();
};
/** A moment `days` ahead of the real clock: invitation and key expiries that are still to come, whatever day the demo runs. */
const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const SYS_ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const SYS_S4 = "a1b2c3d4-0002-4000-8000-000000000002";

export const RESOURCES = ["systems", "credentials", "extraction", "analysis", "rules", "findings", "fixes", "mdm", "glossary", "stewardship", "contracts", "reports", "llm", "users", "licence", "audit", "process"] as const;
export const ACTIONS = ["view", "create", "edit", "approve", "run", "export", "admin"] as const;

type RoleDef = { key: string; name: string; description: string; built_in: boolean; users: number; allow: (r: string, a: string) => boolean };
const NO_VIEW = new Set(["audit", "llm", "users", "licence", "credentials"]);
const ROLE_DEFS: RoleDef[] = [
  { key: "platform_admin", name: "Platform admin", description: "Everything, including users, licence and audit.", built_in: true, users: 1, allow: () => true },
  { key: "programme_lead", name: "Programme lead / CIO", description: "Reads every score, approves, exports and runs reports.", built_in: true, users: 2, allow: (r, a) => (a === "view" ? !NO_VIEW.has(r) : ["approve", "export", "run"].includes(a) && ["reports", "analysis", "fixes"].includes(r)) },
  { key: "data_steward", name: "Data steward", description: "Works the fix ledger and proposes values.", built_in: true, users: 3, allow: (r, a) => (a === "view" ? !NO_VIEW.has(r) : ["create", "edit"].includes(a) && ["fixes", "stewardship", "glossary", "mdm"].includes(r)) },
  { key: "data_owner", name: "Data owner / approver", description: "Approves fix batches for the objects they own.", built_in: true, users: 2, allow: (r, a) => (a === "view" ? !NO_VIEW.has(r) : a === "approve" && ["fixes", "stewardship", "mdm"].includes(r)) },
  { key: "analyst", name: "Analyst", description: "Runs analyses and exports.", built_in: true, users: 1, allow: (r, a) => (a === "view" ? !NO_VIEW.has(r) : ["run", "export"].includes(a) && ["analysis", "reports", "findings"].includes(r)) },
  { key: "sap_basis", name: "SAP Basis / integration admin", description: "Connects systems and runs extraction.", built_in: true, users: 1, allow: (r, a) => (a === "view" ? !["users", "licence", "audit", "llm"].includes(r) : ["systems", "credentials", "extraction"].includes(r) && a !== "approve") },
  { key: "auditor", name: "Auditor", description: "Reads everything, including the audit log. Changes nothing.", built_in: true, users: 0, allow: (_r, a) => a === "view" || a === "export" },
  { key: "viewer", name: "Viewer", description: "Reads scores and reports.", built_in: true, users: 4, allow: (r, a) => a === "view" && !NO_VIEW.has(r) },
  { key: "finance_reviewer", name: "Finance reviewer", description: "A copy of Viewer that can also export finance reports.", built_in: false, users: 1, allow: (r, a) => (a === "view" && !NO_VIEW.has(r)) || (a === "export" && r === "reports") },
];

function matrixOf(def: RoleDef): Matrix {
  const out: Matrix = {};
  for (const r of RESOURCES) {
    out[r] = {};
    for (const a of ACTIONS) out[r][a] = def.allow(r, a);
  }
  return out;
}

interface State {
  users: User[];
  grants: Record<string, UserGrant[]>;
  roles: Role[];
  matrices: Record<string, Matrix>;
  sso: { configured: boolean; issuer: string; client_id: string; has_secret: boolean; display_name: string; allowed_domains: string[]; default_role: "viewer"; enforce: boolean; redirect_uri: string };
  keys: ApiKey[];
  licence: Record<string, unknown>;
  scoring: Record<string, unknown>;
  planner: Record<string, unknown>;
  cost: Record<string, unknown>;
  retention: { policy: Record<string, unknown>; enforcement: Record<string, unknown> };
  mappings: FieldMapping[];
  reference: Record<string, { kind: string; records: number; countries: string[] }[]>;
  audit: AuditEntry[];
  channels: AlertChannel[];
  thresholds: Record<string, unknown>;
  digest: Record<string, unknown>;
  prefs: Preferences;
  history: ReportFile[];
  schedules: ReportSchedule[];
  waves: MigrationWave[];
  requests: Record<string, unknown>[];
  profiles: Record<string, Profile[]>;
  update: { current_version: string; latest_version: string; update_available: boolean; release_notes: string; updater_configured: boolean; progress: string };
  seq: number;
}

const PEOPLE: [string, string, string, string][] = [
  ["Nomsa Dlamini", "nomsa.dlamini@demo-corp.example", "platform_admin", "active"],
  ["Pieter van der Merwe", "pieter.vdm@demo-corp.example", "programme_lead", "active"],
  ["Aisha Khan", "aisha.khan@demo-corp.example", "data_steward", "active"],
  ["Thabo Molefe", "thabo.molefe@demo-corp.example", "data_steward", "active"],
  ["Lerato Naidoo", "lerato.naidoo@demo-corp.example", "data_owner", "active"],
  ["Marco Rossi", "marco.rossi@demo-corp.example", "sap_basis", "active"],
  ["Ines Fernandes", "ines.fernandes@demo-corp.example", "analyst", "invited"],
  ["Jonas Weber", "jonas.weber@demo-corp.example", "viewer", "suspended"],
];

function build(): State {
  const users: User[] = PEOPLE.map(([name, email, role, status], i) => ({
    id: `u-${i + 1}`,
    tenant_id: "t-demo",
    clerk_user_id: null,
    email,
    name,
    role: role as User["role"],
    permissions: null,
    is_active: status !== "suspended",
    last_login: status === "invited" ? null : ago(i * 2 + 1, 7 + i),
    created_at: ago(120 - i * 9),
    status: status as User["status"],
    must_change_password: false,
    invited_at: ago(120 - i * 9),
    invite_sent_at: ago(120 - i * 9),
    invite_status: status === "invited" ? "sent" : "accepted",
    invite_expires_at: status === "invited" ? soon(5) : null,
    locked_until: null,
    password_changed_at: ago(60),
  }));
  const roleName = (k: string) => ROLE_DEFS.find((r) => r.key === k)?.name ?? k;
  const grants: Record<string, UserGrant[]> = {};
  users.forEach((u, i) => {
    grants[u.id] = [{ id: `g-${i + 1}`, role_key: u.role, role_name: roleName(u.role), system_id: null, system_name: null, module: null, expires_at: null, expired: false }];
  });
  grants["u-3"].push({ id: "g-3b", role_key: "data_owner", role_name: roleName("data_owner"), system_id: SYS_ECC, system_name: "ECC production", module: "material_master", expires_at: soon(30), expired: false });
  const roles: Role[] = ROLE_DEFS.map((d) => ({ key: d.key, name: d.name, description: d.description, built_in: d.built_in, legacy: false, cloned_from: d.built_in ? null : "viewer", updated_at: d.built_in ? null : ago(12), users: d.users }));
  const matrices: Record<string, Matrix> = {};
  ROLE_DEFS.forEach((d) => (matrices[d.key] = matrixOf(d)));
  const mappingFields: [string, string, string, string, string][] = [
    ["material_master", "MARA.MATNR", "Material number", "Matnr", "string"],
    ["material_master", "MARA.MTART", "Material type", "Type", "string"],
    ["material_master", "MARA.MATKL", "Material group", "Group", "string"],
    ["material_master", "MARA.MEINS", "Base unit of measure", "UoM", "string"],
    ["business_partner", "BUT000.PARTNER", "Business partner", "BP number", "string"],
    ["business_partner", "BUT000.BU_GROUP", "Grouping", "Group", "string"],
    ["accounts_payable", "LFA1.LIFNR", "Vendor number", "Supplier", "string"],
    ["accounts_payable", "LFA1.STCD1", "Tax number 1", "VAT", "string"],
    ["accounts_receivable", "KNA1.KUNNR", "Customer number", "Customer", "string"],
    ["accounts_receivable", "KNA1.LAND1", "Country", "Country", "string"],
    ["fi_gl", "SKA1.SAKNR", "G/L account number", "Account", "string"],
    ["mm_purchasing", "EKKO.EBELN", "Purchasing document", "PO", "string"],
  ];
  const mappings: FieldMapping[] = mappingFields.map(([module, f, l, cl, t], i) => ({
    id: `fm-${i + 1}`,
    module,
    standard_field: f,
    standard_label: l,
    customer_field: i % 3 === 0 ? `${f.split(".")[1]}_X` : null,
    customer_label: i % 3 === 0 ? cl : null,
    data_type: t,
    is_mapped: i % 3 === 0,
    notes: null,
    updated_at: ago(i + 3),
  }));
  // The name the API records for each change (the payload's name), as the audit middleware stores it.
  const actions: [string, string, string, string, string, string | null][] = [
    ["create", "users", "POST", "/api/v1/users/invite", "u-7", "Ines Fernandes"],
    ["update", "work", "POST", "/api/v1/work/decide", "batch", "Batch B-241"],
    ["update", "settings", "PUT", "/api/v1/settings/scoring", "scoring", "Scoring weights"],
    ["sync", "systems", "POST", "/api/v1/systems/extract", SYS_ECC, "ECC production"],
    ["update", "roles", "PUT", "/api/v1/roles/finance_reviewer/permissions", "finance_reviewer", "Finance reviewer"],
    ["create", "reports", "POST", "/api/v1/reports/schedules", "sch-1", "Weekly board pack"],
    ["api_key.create", "api-keys", "POST", "/api/v1/admin/api-keys", "key-1", "Nightly export script"],
    ["analyse", "versions", "POST", "/api/v1/versions/analyse", "d3229ded", null],
    ["update", "users", "PUT", "/api/v1/users/u-8", "u-8", "Jonas Weber"],
    ["update", "migration", "PATCH", "/api/v1/migration/waves/w-1", "w-1", "Wave 1: finance foundations"],
  ];
  const audit: AuditEntry[] = Array.from({ length: 36 }, (_, i) => {
    const [action, entity, method, path, id, name] = actions[i % actions.length];
    const actor = users[(i * 3) % 6];
    return {
      id: `au-${i + 1}`,
      actor_user_id: actor.id,
      actor_email: actor.email,
      action,
      entity_type: entity,
      entity_id: id,
      method,
      path,
      status_code: i % 11 === 5 ? 403 : 200,
      ip: `10.20.0.${10 + (i % 7)}`,
      user_agent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0",
      before_json: i % 3 === 0 ? { is_active: true } : null,
      after_json: i % 3 === 0 && entity === "users" ? { name, is_active: false } : name ? { name } : null,
      created_at: ago(i * 0.6 + 0.1, 6 + (i % 12)),
    };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const channels: AlertChannel[] = [
    { id: "ch-1", kind: "email", target: "dq-team@demo-corp.example", digest: "daily", report_pack: "weekly", immediate_critical: true, enabled: true, created_at: ago(90), has_secret: false },
    { id: "ch-2", kind: "teams", target: "outlook.office.com", digest: "weekly", immediate_critical: false, enabled: true, created_at: ago(60), has_secret: false },
    { id: "ch-3", kind: "webhook", target: "hooks.demo-corp.example", digest: "off", immediate_critical: true, enabled: false, created_at: ago(30), has_secret: true },
  ];
  const history: ReportFile[] = [
    ["board", "Board pack", "pdf", 1_840_000, "schedule", "Pieter van der Merwe"],
    ["workbook", "Analyst workbook", "xlsx", 6_420_000, "download", "Aisha Khan"],
    ["analysis", "Analysis report", "pdf", 2_310_000, "download", "Marco Rossi"],
    ["trend", "Trend report", "pdf", 980_000, "schedule", "Pieter van der Merwe"],
    ["board", "Board pack", "pdf", 1_790_000, "schedule", "Pieter van der Merwe"],
    ["rules", "Rule catalogue", "pdf", 1_120_000, "download", "Nomsa Dlamini"],
  ].map(([kind, name, format, size, source, by], i) => ({
    id: `rf-${i + 1}`,
    kind: String(kind),
    name: String(name),
    version_id: i === 5 ? null : "d3229ded-0708-4967-9dfb-1b7f4fada953",
    run_label: i === 5 ? null : "Run of 16 Oct 2026",
    run_at: i === 5 ? null : "2026-10-16T05:17:00Z",
    format: format as ReportFile["format"],
    file_name: `${String(kind)}-2026-10-${String(16 - i).padStart(2, "0")}.${String(format)}`,
    size_bytes: Number(size),
    source: source as ReportFile["source"],
    schedule_id: source === "schedule" ? "sch-1" : null,
    created_by: "u-2",
    created_by_label: String(by),
    created_at: ago(i * 3 + 1, 6),
    can_delete: true,
  }));
  const schedules: ReportSchedule[] = [
    mkSchedule("sch-1", { name: "Board pack for the steering committee", kind: "board", format: "pdf", params: { scope: "latest", module: null }, cadence: "weekly", time_of_day: "07:00", weekday: 0, day_of_month: null, timezone: "Africa/Johannesburg", recipient_user_ids: ["u-2"], recipient_channel_ids: ["ch-1"], enabled: true }, { last: "sent", lastAt: ago(2, 5), next: "2026-10-26T05:00:00Z" }),
    mkSchedule("sch-2", { name: "Analyst workbook, monthly", kind: "workbook", format: "xlsx", params: { scope: "latest", module: null }, cadence: "monthly", time_of_day: "06:30", weekday: null, day_of_month: 1, timezone: "Africa/Johannesburg", recipient_user_ids: ["u-3", "u-4"], recipient_channel_ids: [], enabled: true }, { last: "partial", lastAt: ago(19, 4), next: "2026-11-01T04:30:00Z" }),
    mkSchedule("sch-3", { name: "Trend report, daily", kind: "trend", format: "pdf", params: { scope: SYS_ECC, module: null }, cadence: "daily", time_of_day: "08:00", weekday: null, day_of_month: null, timezone: "Africa/Johannesburg", recipient_user_ids: [], recipient_channel_ids: ["ch-2"], enabled: false }, { last: "failed", lastAt: ago(9, 6), next: null }),
  ];
  const waves: MigrationWave[] = [
    wave("w-1", "Wave 1: finance foundations", ["fi_gl", "asset_accounting", "controlling", "accounts_payable"], "2026-11-16", "mock2", { v: "no_go", s: 71.4 }),
    wave("w-2", "Wave 2: master data", ["material_master", "business_partner", "accounts_receivable"], "2027-01-18", "mock1", { v: "at_risk", s: 78.9 }),
    wave("w-3", "Wave 3: operations", ["mm_purchasing", "sd_sales_orders", "plant_maintenance"], null, "plan", { v: null, s: null }),
  ];
  return {
    users,
    grants,
    roles,
    matrices,
    sso: { configured: true, issuer: "https://login.demo-corp.example/tenant-4f2a/v2.0", client_id: "meridian-demo-client", has_secret: true, display_name: "Demo Corp login", allowed_domains: ["demo-corp.example"], default_role: "viewer", enforce: false, redirect_uri: "https://meridian.demo-corp.example/api/v1/auth/oidc/callback" },
    keys: [
      { id: "key-1", name: "BI export job", key_prefix: "mk_7f3a91", user_id: "svc-1", status: "active", grants: [{ id: "kg-1", role_key: "analyst", role_name: "Analyst", system_id: null, system_name: null, module: null }], created_by: "u-1", created_by_name: "Nomsa Dlamini", created_at: ago(70), expires_at: soon(120), last_used_at: ago(0.2), revoked_at: null },
      { id: "key-2", name: "ERP monitor (read only)", key_prefix: "mk_c20b44", user_id: "svc-2", status: "active", grants: [{ id: "kg-2", role_key: "viewer", role_name: "Viewer", system_id: SYS_ECC, system_name: "ECC production", module: null }], created_by: "u-1", created_by_name: "Nomsa Dlamini", created_at: ago(40), expires_at: null, last_used_at: null, revoked_at: null },
      { id: "key-3", name: "Old migration script", key_prefix: "mk_01e9d8", user_id: "svc-3", status: "revoked", grants: [{ id: "kg-3", role_key: "analyst", role_name: "Analyst", system_id: null, system_name: null, module: null }], created_by: "u-1", created_by_name: "Nomsa Dlamini", created_at: ago(200), expires_at: null, last_used_at: ago(90), revoked_at: ago(88) },
    ],
    licence: {
      valid: true, status: "active", tenant_id: "t-demo", company_name: "Demo Corp", tier: "enterprise", expiry_date: "2027-03-31", days_remaining: 162, seats_used: 8, seats: 25,
      enabled_modules: ["material_master", "business_partner", "accounts_payable", "accounts_receivable", "fi_gl", "asset_accounting", "controlling", "mm_purchasing", "sd_sales_orders", "hcm"],
      enabled_menu_items: [], features: { ask_meridian: true, export_reports: true, run_sync: true, field_mapping_self_service: true, max_users: 25 }, last_validated: ago(0.3),
      // Set only while the licence service is unreachable (status "offline_grace"); the demo is online
      offline_grace: null,
    },
    scoring: {
      dimension_weights: { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 },
      module_weights: {}, thresholds: { target: 90, warning: 75, critical: 60 },
      severity_weights: { critical: 4, high: 3, medium: 2, low: 1 }, severity_multipliers: { critical: 5, high: 2, medium: 1, low: 1 },
      critical_tolerance: { pct: 0.1, rows: 25 },
      defaults: { dimension_weights: { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 }, module_weights: {}, thresholds: { target: 90, warning: 75, critical: 60 }, severity_weights: { critical: 4, high: 3, medium: 2, low: 1 }, severity_multipliers: { critical: 5, high: 2, medium: 1, low: 1 }, critical_tolerance: { pct: 0.1, rows: 25 } },
    },
    planner: { minutes_per_record: 2, investigation_hours: 1, cleaning_item_hours: 0.5, exception_hours: 2, sprint_hours: 60, cost_per_record: 38, currency: "ZAR" },
    cost: { currency: "ZAR", severity: { critical: { per_record: 120 }, high: { per_record: 60 }, medium: { per_record: 25 }, low: { per_record: 5 } }, modules: {}, rules: {}, features: { MIGO: 38, ME21N: 55, VF01: 72 }, impact: { duplicate_payment: { unit_cost: 4200, factor: 1, mitigation: 0.6 } }, config_alignment: { ghost_config: 150 }, subscription_monthly: 48000 },
    retention: { policy: { versions_days: 365, reports_days: 180, audit_days: null, keep_baseline: true, keep_latest_per_system: 3 }, enforcement: { flag_enabled: true, dry_run_until: "2026-10-24T00:00:00Z", enforced: false } },
    mappings,
    reference: { [SYS_ECC]: [{ kind: "postal-codes", records: 48210, countries: ["ZA", "DE", "GB"] }], [SYS_S4]: [] },
    audit,
    channels,
    thresholds: { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: { material_master: 75, accounts_payable: 80 }, readiness_dqs_threshold: 75, readiness_waves: {} },
    digest: { email: "dq-team@demo-corp.example", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true },
    prefs: { theme: "system", density: "default", locale: "en-GB", timezone: "Africa/Johannesburg", notifications: { digest: "weekly", immediate_critical: true, channels: { email: true } } },
    history,
    schedules,
    waves,
    requests: [{ id: "ar-1", user_id: "u-4", resource: "fixes", action: "approve", system_id: SYS_ECC, module: "material_master", reason: "I cover approvals while Lerato is away.", status: "open", decided_by: null, decided_at: null, created_at: ago(1) }],
    profiles: {
      [SYS_ECC]: [
        { id: "pf-1", system_id: SYS_ECC, domain: "material_master", tables: ["MARA", "MARC", "MBEW"], schedule_cron: "0 4 * * 1", active: true, last_run_at: ago(3, 4), next_run_at: soon(4), extraction_mode: "delta" },
        { id: "pf-2", system_id: SYS_ECC, domain: "business_partner", tables: ["BUT000", "ADRC"], schedule_cron: "30 2 * * *", active: false, last_run_at: ago(9, 2), next_run_at: null, extraction_mode: "full" },
      ],
    },
    update: { current_version: "0.1.1", latest_version: "0.1.2", update_available: true, release_notes: "Faster ledger filters, report schedules in the new interface and a fix for retention previews.", updater_configured: true, progress: "idle" },
    seq: 100,
  };
}

function mkSchedule(id: string, i: ReportScheduleInput, o: { last: ReportSchedule["last_status"]; lastAt: string | null; next: string | null }): ReportSchedule {
  const day = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const when = i.cadence === "daily" ? "Every day" : i.cadence === "weekly" ? `Every ${day[i.weekday ?? 0]}` : `On day ${i.day_of_month ?? 1} of the month`;
  return {
    id,
    name: i.name,
    kind: i.kind,
    format: i.format ?? "pdf",
    params: i.params,
    cadence: i.cadence,
    time_of_day: i.time_of_day,
    weekday: i.weekday ?? null,
    day_of_month: i.day_of_month ?? null,
    timezone: i.timezone ?? "Africa/Johannesburg",
    recipient_user_ids: i.recipient_user_ids,
    recipient_channel_ids: i.recipient_channel_ids,
    enabled: i.enabled,
    last_run_at: o.lastAt,
    last_status: o.last,
    next_run_at: i.enabled ? o.next : null,
    created_by: "u-2",
    created_at: ago(80),
    summary: `${when} at ${i.time_of_day} (${i.timezone ?? "Africa/Johannesburg"})`,
    can_edit: true,
  };
}

function wave(id: string, name: string, modules: string[], date: string | null, stage: MigrationWave["stage"], last: { v: MigrationWave["last_verdict"] | null; s: number | null }): MigrationWave {
  return {
    id, name, source_system_id: SYS_ECC, target_system_id: SYS_S4, target_release: "2025", modules, target_date: date, stage, min_readiness: 95, min_dqs: 85,
    signed_off_by: null, signed_off_at: null, created_at: ago(60), updated_at: ago(5),
    last_run_id: last.v ? "d3229ded-0708-4967-9dfb-1b7f4fada953" : null, last_verdict: last.v ?? null, last_score: last.s, last_completed_at: last.v ? ago(4) : null, trend: last.s ? [last.s - 4, last.s - 2, last.s - 1, last.s] : [],
  };
}

let S: State | null = null;
const st = (): State => (S ??= build());

/** Test seam and `?fixture=1` reload: forget every change and start from the demo tenant again. */
export function resetAdminFixture(): void {
  S = null;
}

const text = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const nextId = (p: string): string => `${p}-${++st().seq}`;

function userView(u: User): User {
  return { ...u, grants: clone(st().grants[u.id] ?? []) as User["grants"] };
}

function statusOf(u: User): User["status"] {
  if (!u.is_active) return "suspended";
  if (u.invite_status && u.invite_status !== "accepted") return "invited";
  return "active";
}

function effectiveFor(userId: string, extraRole?: string) {
  const s = st();
  const keys = new Set((s.grants[userId] ?? []).map((g) => g.role_key));
  if (extraRole) keys.add(extraRole);
  const resources: Record<string, Record<string, boolean>> = {};
  for (const r of RESOURCES) {
    resources[r] = {};
    for (const a of ACTIONS) resources[r][a] = [...keys].some((k) => s.matrices[k]?.[r]?.[a]);
  }
  const actions = new Set<string>();
  if (resources.users.admin) actions.add("manage_users");
  if (resources.licence.admin) actions.add("manage_system");
  if (resources.fixes.approve) actions.add("approve");
  if (resources.reports.export) actions.add("export");
  if (resources.analysis.run) actions.add("analyse");
  if (resources.fixes.edit) actions.add("apply");
  const names = (k: string) => s.roles.find((r) => r.key === k)?.name ?? k;
  return {
    role: [...keys][0] ?? "viewer",
    roles: [...keys].map((k) => ({ key: k, name: names(k), system_id: null, module: null })),
    actions: [...actions].sort(),
    resources,
    scopes: [],
    home: "/",
  };
}

function seatsUsed(): number {
  return st().users.filter((u) => u.is_active).length;
}

function csvRows(csv: string) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = lines[0]?.toLowerCase().includes("email") ? lines.slice(1) : lines;
  return body.map((line, i) => {
    const [email = "", name = "", role = "viewer"] = line.split(",").map((c) => c.trim());
    const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && st().roles.some((r) => r.key === role);
    return { line: i + 2, email, name, role, system_id: null, system_name: null, module: null, ok, error: ok ? null : !st().roles.some((r) => r.key === role) ? `Unknown role ${role}` : "Not an email address" };
  });
}

function filterAudit(params: Record<string, unknown>): AuditEntry[] {
  const p = params;
  return st().audit.filter((e) =>
    (!p.actor_user_id || e.actor_user_id === p.actor_user_id) &&
    (!p.action || e.action.includes(text(p.action))) &&
    (!p.entity_type || e.entity_type === p.entity_type) &&
    (!p.entity_id || e.entity_id === p.entity_id) &&
    (!p.method || e.method === p.method) &&
    (!p.since || e.created_at >= text(p.since)) &&
    (!p.until || e.created_at <= `${text(p.until)}${text(p.until).length <= 10 ? "T23:59:59Z" : ""}`) &&
    (!p.path_contains || e.path.includes(text(p.path_contains))),
  );
}

const CATALOGUE: Omit<CatalogueEntry, "url" | "last_built_at">[] = [
  { id: "board", name: "Board pack", format: "PDF", about: "Where data quality stands, what moved and what it is worth: the pack for a steering committee.", sections: ["Verdict", "Movement", "Value at risk", "Migration waves"], page_estimate: 8, requires: ["run"] },
  { id: "workbook", name: "Analyst workbook", format: "XLSX", about: "Every object, rule and failing record count for one run in a workbook.", sections: ["Objects", "Rules", "Records"], page_estimate: 0, requires: ["run"] },
  { id: "analysis", name: "Analysis report", format: "PDF", about: "One run read end to end: coverage, scores, failing rules.", sections: ["Coverage", "Scores", "Rules"], page_estimate: 14, requires: ["run"] },
  { id: "trend", name: "Trend report", format: "PDF", about: "Score by object across runs.", sections: ["Trend"], page_estimate: 5, requires: [] },
  { id: "rules", name: "Rule catalogue", format: "PDF", about: "Every rule with its definition and severity.", sections: ["Rules"], page_estimate: 40, requires: [] },
  { id: "object", name: "Object report", format: "PDF", about: "One object's rules and fields for one run.", sections: ["Object"], page_estimate: 6, requires: ["run", "module"] },
];

function catalogue(params: Record<string, unknown>): CatalogueEntry[] {
  const v = text(params.version_id);
  const m = text(params.module);
  return CATALOGUE.map((c) => {
    const ready = (!c.requires.includes("run") || v) && (!c.requires.includes("module") || m);
    const ext = c.format.toLowerCase();
    const url = !ready ? null : c.id === "board" ? `/api/v1/reports/board/${v}.pdf` : c.id === "workbook" ? `/api/v1/reports/${v}/workbook.xlsx${m ? `?module=${m}` : ""}` : c.id === "object" ? `/api/v1/reports/object/${v}/${m}.pdf` : c.id === "analysis" ? `/api/v1/reports/analysis/${v}.pdf` : `/api/v1/reports/${c.id}.${ext}`;
    return { ...c, url, last_built_at: st().history.find((h) => h.kind === c.id)?.created_at ?? null };
  });
}

function scheduleOptions() {
  return {
    timezone: "Africa/Johannesburg",
    types: CATALOGUE.filter((c) => c.id !== "object").map((c) => ({ id: c.id, name: c.name, format: c.format.toLowerCase() as "pdf" | "xlsx" | "json", needs_run: false, needs_module: false })),
    users: st().users.filter((u) => u.is_active).map((u) => ({ id: u.id, label: u.name, detail: u.email })),
    channels: st().channels.map((c) => ({ id: c.id, label: `${c.kind}: ${c.target}` })),
    systems: [{ id: SYS_ECC, label: "ECC production" }, { id: SYS_S4, label: "S/4HANA sandbox" }],
    modules: ["material_master", "business_partner", "accounts_payable", "accounts_receivable", "fi_gl"],
  };
}

/** A read in the admin area, or NONE_ADMIN when the path is not one of its own. */
export function adminFixtureResponse(path: string, params: Record<string, unknown>): unknown {
  const s = st();
  if (path === "/users") {
    const q = text(params.q).toLowerCase();
    const list = s.users
      .filter((u) => (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && (!params.status || statusOf(u) === params.status) && (!params.role || (s.grants[u.id] ?? []).some((g) => g.role_key === params.role)))
      .map(userView);
    return { users: list };
  }
  const grants = /^\/users\/([^/]+)\/grants$/.exec(path);
  if (grants) return clone(s.grants[decodeURIComponent(grants[1])] ?? []);
  const eff = /^\/users\/([^/]+)\/effective$/.exec(path);
  if (eff) {
    const id = decodeURIComponent(eff[1]);
    const before = effectiveFor(id);
    if (!params.with_grant) return before;
    const after = effectiveFor(id, text(params.with_grant));
    const added_pairs: [string, string][] = [];
    for (const r of RESOURCES) for (const a of ACTIONS) if (!before.resources[r][a] && after.resources[r][a]) added_pairs.push([r, a]);
    return { before, after, diff: { added_actions: after.actions.filter((a) => !before.actions.includes(a)), added_pairs, widened_scopes: [{ system_id: params.system_id ?? null, module: params.module ?? null }] } };
  }
  if (path === "/access-requests") return clone(s.requests.filter((r) => !params.status || r.status === params.status));
  if (path === "/roles") return clone(s.roles);
  if (path === "/roles/matrix") {
    return { resources: [...RESOURCES], actions: [...ACTIONS], roles: s.roles.map((r) => ({ key: r.key, name: r.name, built_in: r.built_in, legacy: false, matrix: clone(s.matrices[r.key]), legacy_actions: [] })) };
  }
  const perm = /^\/roles\/([^/]+)\/permissions$/.exec(path);
  if (perm) {
    const key = decodeURIComponent(perm[1]);
    if (!s.matrices[key]) throw new AdminNotFound(path);
    return { key, built_in: s.roles.find((r) => r.key === key)?.built_in ?? false, matrix: clone(s.matrices[key]) };
  }
  if (path === "/admin/sso") return clone(s.sso);
  if (path === "/admin/api-keys") return clone(s.keys);
  if (path === "/licence") return { ...s.licence, seats_used: seatsUsed() };
  if (path === "/exceptions/billing") {
    const p = text(params.period);
    if (p > new Date().toISOString().slice(0, 7)) throw new AdminNotFound(path);
    return { period: p, currency: "ZAR", tier1_count: 42, tier2_count: 17, tier3_count: 6, tier4_count: 1, tier1_amount: 4200, tier2_amount: 5100, tier3_amount: 3600, tier4_amount: 2500, base_fee: 48000, total_amount: 63400, stripe_invoice_id: p < new Date().toISOString().slice(0, 7) ? "in_demo" : null };
  }
  if (path === "/system/update-status") return { current_version: s.update.current_version, latest_version: s.update.latest_version, update_available: s.update.update_available, release_notes: s.update.release_notes, updater_configured: s.update.updater_configured };
  if (path === "/system/update/progress") return { status: s.update.progress, message: s.update.progress === "done" ? "Updated to " + s.update.current_version : null, started_at: null, updated_at: null };
  if (path === "/admin/doctor") {
    return { last_checked: ago(0, 7), items: [
      { id: "db", label: "Database", status: "ok", detail: "Connected, 14 ms" },
      { id: "redis", label: "Cache and queue", status: "ok", detail: "Connected" },
      { id: "worker", label: "Background workers", status: "ok", detail: "3 workers, queue empty" },
      { id: "licence", label: "Licence", status: "ok", detail: "Expires 2027-03-31" },
      { id: "email", label: "Email delivery", status: "warn", detail: "No email backend configured" },
      { id: "storage", label: "File storage", status: "ok", detail: "Garage reachable, 41 percent used" },
    ] };
  }
  if (path === "/health") return { status: "ok", version: s.update.current_version, llm_provider: "ollama", llm_connected: true, licence: "valid", email_backend: null, timestamp: NOW };
  if (path === "/settings") return { name: "Demo Corp", licensed_modules: (s.licence.enabled_modules as string[]), planner_config: s.planner, dqs_weights: null, alert_thresholds: s.thresholds, notification_config: s.digest, stripe_customer_id: null, live_writeback: false };
  if (path === "/settings/scoring") return clone(s.scoring);
  if (path === "/settings/cost-model") return { defaults: s.cost, tenant: s.cost, effective: clone(s.cost) };
  if (path === "/settings/cost-model/features") return { features: [{ feature: "MIGO", l1: "Procure to pay" }, { feature: "ME21N", l1: "Procure to pay" }, { feature: "VF01", l1: "Order to cash" }, { feature: "FB01", l1: "Record to report" }] };
  if (path === "/settings/retention") return clone(s.retention);
  if (path === "/settings/retention/preview") return { items: [{ version_id: "b0000000-0000-4000-8000-000000000000", label: null, run_at: "2026-08-28T05:11:00Z", system_id: SYS_ECC, blocked_reason: null, rows_by_table: { findings: 18420, record_issues: 9210 }, bytes_freed: 48_000_000 }] };
  if (path === "/settings/purge-log") return { items: [{ id: "pl-1", kind: "version", target_id: "b0000000", dry_run: true, rows_by_table: { findings: 18420 }, bytes_freed: 48_000_000, blocked_reason: null, actor_email: null, created_at: ago(1, 2) }] };
  if (path === "/field-mappings") {
    const list = s.mappings.filter((m) => (!params.module || m.module === params.module) && (params.is_mapped === undefined || String(m.is_mapped) === String(params.is_mapped)) && (!params.search || `${m.standard_field} ${m.standard_label ?? ""} ${m.customer_field ?? ""}`.toLowerCase().includes(text(params.search).toLowerCase())));
    return { mappings: clone(list), total: list.length, self_service_enabled: true };
  }
  const ref = /^\/systems\/([^/]+)\/reference$/.exec(path);
  if (ref) return clone(s.reference[decodeURIComponent(ref[1])] ?? []);
  if (path === "/audit") {
    const all = filterAudit(params);
    const limit = Number(params.limit ?? 50);
    const offset = Number(params.offset ?? 0);
    return { entries: clone(all.slice(offset, offset + limit)), total: all.length, limit, offset };
  }
  if (path === "/audit/summary") {
    const counts = new Map<string, number>();
    s.audit.forEach((e) => counts.set(`${e.action}|${e.entity_type}`, (counts.get(`${e.action}|${e.entity_type}`) ?? 0) + 1));
    return { summary: [...counts.entries()].map(([k, count]) => ({ action: k.split("|")[0], entity_type: k.split("|")[1], count })), total: s.audit.length };
  }
  if (path === "/audit/llm") return { entries: [{ id: "ll-1", service_name: "remediation_agent", called_at: ago(1), model_version: "local-8b", prompt_hash: "9f2c1a", token_count: 812, latency_ms: 3420, success: true, deterministic_hit: false, skip_reason: null }], total: 1, limit: 50, offset: 0, cache: [{ service_name: "remediation_agent", decisions: 40, deterministic: 31 }] };
  if (path === "/alert-channels") return { channels: clone(s.channels) };
  if (path === "/me/preferences") return clone(s.prefs);
  if (path === "/reports/catalogue") return catalogue(params);
  if (path === "/reports/history") {
    const list = s.history.filter((h) => !params.kind || h.kind === params.kind);
    return { total: list.length, limit: Number(params.limit ?? 50), offset: Number(params.offset ?? 0), items: clone(list) };
  }
  if (path === "/reports/schedules") return clone(s.schedules);
  if (path === "/reports/schedules/options") return scheduleOptions();
  if (path === "/migration/waves") return { waves: clone(s.waves) };
  return NONE_ADMIN;
}

/** A write in the admin area, or NONE_ADMIN when the path is not one of its own. */
export function adminFixtureWrite(method: string, path: string, body: unknown, params: Record<string, unknown>): unknown {
  const s = st();
  const b = (body ?? {}) as Record<string, unknown>;
  const userId = /^\/users\/([^/]+)$/.exec(path)?.[1];
  if (userId && method === "PUT") {
    const u = s.users.find((x) => x.id === decodeURIComponent(userId));
    if (!u) throw new AdminNotFound(path);
    if (typeof b.is_active === "boolean") u.is_active = b.is_active;
    u.status = statusOf(u);
    return userView(u);
  }
  if (userId && method === "DELETE") {
    const id = decodeURIComponent(userId);
    s.users = s.users.filter((u) => u.id !== id);
    delete s.grants[id];
    return { id, status: "removed" };
  }
  if (method === "POST" && path === "/users/invite") {
    const email = text(b.email);
    if (s.users.some((u) => u.email === email)) throw new AdminRefused(409, `${email} is already a user.`);
    const limit = Number((s.licence.features as { max_users: number }).max_users);
    if (seatsUsed() >= limit) throw new AdminRefused(402, "No seats left on the licence.");
    const grants = (b.grants as { role_key: string; system_id?: string | null; module?: string | null }[]) ?? [];
    const id = nextId("u");
    const role = (grants.find((g) => !g.system_id && !g.module)?.role_key ?? "viewer") as User["role"];
    s.users.push({ id, tenant_id: "t-demo", clerk_user_id: null, email, name: text(b.name) || email.split("@")[0], role, permissions: null, is_active: true, last_login: null, created_at: NOW, status: "invited", invite_status: "sent", invited_at: NOW, invite_sent_at: NOW, invite_expires_at: soon(7) });
    s.grants[id] = grants.map((g) => ({ id: nextId("g"), role_key: g.role_key, role_name: s.roles.find((r) => r.key === g.role_key)?.name ?? g.role_key, system_id: g.system_id ?? null, system_name: g.system_id === SYS_ECC ? "ECC production" : null, module: g.module ?? null, expires_at: null, expired: false }));
    return { id, email, role, status: "invited" };
  }
  const inviteAct = /^\/users\/([^/]+)\/invite\/(resend|link)$/.exec(path);
  if (inviteAct && method === "POST") {
    const id = decodeURIComponent(inviteAct[1]);
    return inviteAct[2] === "resend" ? { id, invite_status: "sent", invite_expires_at: soon(7) } : { id, url: `https://meridian.demo-corp.example/accept?token=demo-${id}`, expires_at: soon(7) };
  }
  const reset = /^\/users\/([^/]+)\/reset-password$/.exec(path);
  if (reset && method === "POST") {
    const id = decodeURIComponent(reset[1]);
    const email = b.send_email === true;
    return { id, must_change_password: true, emailed: email, link: email ? null : `https://meridian.demo-corp.example/reset?token=demo-${id}` };
  }
  if (method === "POST" && path === "/users/bulk") {
    const ids = (b.ids as string[]) ?? [];
    const action = text(b.action) as "suspend" | "reactivate" | "resend" | "reset";
    const results = ids.map((id) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return { id, ok: false, error: "Not found" };
      if (action === "suspend") u.is_active = false;
      if (action === "reactivate") u.is_active = true;
      u.status = statusOf(u);
      return { id, ok: true, error: null };
    });
    return { action, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }
  if (method === "POST" && (path === "/users/import/preview" || path === "/users/import")) {
    const rows = csvRows(text(b.csv));
    const accepted = rows.filter((r) => r.ok);
    if (path === "/users/import/preview") {
      const limit = Number((s.licence.features as { max_users: number }).max_users);
      return { rows, accepted: accepted.length, rejected: rows.length - accepted.length, seats: { used: seatsUsed(), limit, needed: accepted.length, available: limit - seatsUsed(), ok: seatsUsed() + accepted.length <= limit } };
    }
    const created = accepted.map((r) => {
      const id = nextId("u");
      s.users.push({ id, tenant_id: "t-demo", clerk_user_id: null, email: r.email, name: r.name || r.email, role: r.role as User["role"], permissions: null, is_active: true, last_login: null, created_at: NOW, status: "invited", invite_status: "sent", invite_expires_at: soon(7) });
      s.grants[id] = [{ id: nextId("g"), role_key: r.role, role_name: s.roles.find((x) => x.key === r.role)?.name ?? r.role, system_id: null, system_name: null, module: null, expires_at: null, expired: false }];
      return { line: r.line, id, email: r.email };
    });
    return { created, skipped: rows.filter((r) => !r.ok).map((r) => ({ line: r.line, email: r.email, error: r.error ?? "Skipped" })) };
  }
  const gAdd = /^\/users\/([^/]+)\/grants$/.exec(path);
  if (gAdd && method === "POST") {
    const id = decodeURIComponent(gAdd[1]);
    const g: UserGrant = { id: nextId("g"), role_key: text(b.role_key), role_name: s.roles.find((r) => r.key === b.role_key)?.name ?? text(b.role_key), system_id: (b.system_id as string | null) ?? null, system_name: b.system_id === SYS_ECC ? "ECC production" : b.system_id === SYS_S4 ? "S/4HANA sandbox" : null, module: (b.module as string | null) ?? null, expires_at: (b.expires_at as string | null) ?? null, expired: false };
    (s.grants[id] ??= []).push(g);
    return { id: g.id, role_key: g.role_key, system_id: g.system_id, module: g.module, user_id: id, granted_by: "u-1", created_at: NOW, expires_at: g.expires_at };
  }
  const gDel = /^\/users\/([^/]+)\/grants\/([^/]+)$/.exec(path);
  if (gDel && method === "DELETE") {
    const id = decodeURIComponent(gDel[1]);
    s.grants[id] = (s.grants[id] ?? []).filter((g) => g.id !== decodeURIComponent(gDel[2]));
    return { id: decodeURIComponent(gDel[2]), status: "removed" };
  }
  if (/^\/users\/[^/]+\/object-approvals\/convert$/.test(path)) return { converted: [], skipped: [], kept: [], cleared: false, confirmed: b.confirm === true };
  const decide = /^\/access-requests\/([^/]+)\/decide$/.exec(path);
  if (decide && method === "POST") {
    const r = s.requests.find((x) => x.id === decodeURIComponent(decide[1]));
    if (!r) throw new AdminNotFound(path);
    r.status = b.decision;
    r.decided_at = NOW;
    r.decided_by = "u-1";
    if (b.decision === "granted" && b.role_key) (s.grants[text(r.user_id)] ??= []).push({ id: nextId("g"), role_key: text(b.role_key), role_name: s.roles.find((x) => x.key === b.role_key)?.name ?? text(b.role_key), system_id: (r.system_id as string | null) ?? null, system_name: null, module: (r.module as string | null) ?? null, expires_at: null, expired: false });
    return clone(r);
  }
  if (method === "POST" && path === "/roles") {
    const from = s.roles.find((r) => r.key === b.cloned_from);
    if (!from) throw new AdminRefused(404, "The role to copy does not exist.");
    const name = text(b.name);
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (s.roles.some((r) => r.key === key)) throw new AdminRefused(409, `A role named '${name}' already exists.`);
    const role: Role = { key, name, description: text(b.description) || null, built_in: false, legacy: false, cloned_from: from.key, updated_at: NOW, users: 0 };
    s.roles.push(role);
    s.matrices[key] = clone(s.matrices[from.key]);
    return clone(role);
  }
  const roleKey = /^\/roles\/([^/]+)$/.exec(path)?.[1];
  if (roleKey && method === "PUT") {
    const r = s.roles.find((x) => x.key === decodeURIComponent(roleKey));
    if (!r) throw new AdminNotFound(path);
    if (r.built_in) throw new AdminRefused(403, "Built-in roles cannot be changed.");
    if (b.name !== undefined) r.name = text(b.name);
    if (b.description !== undefined) r.description = text(b.description) || null;
    r.updated_at = NOW;
    return clone(r);
  }
  if (roleKey && method === "DELETE") {
    const key = decodeURIComponent(roleKey);
    const r = s.roles.find((x) => x.key === key);
    if (!r) throw new AdminNotFound(path);
    if (r.built_in) throw new AdminRefused(403, "Built-in roles cannot be removed.");
    if ((r.users ?? 0) > 0) throw new AdminRefused(409, `${r.users} ${r.users === 1 ? "person has" : "people have"} this role. Move them first.`);
    s.roles = s.roles.filter((x) => x.key !== key);
    delete s.matrices[key];
    return { key, status: "removed" };
  }
  const rolePerm = /^\/roles\/([^/]+)\/permissions$/.exec(path);
  if (rolePerm && method === "PUT") {
    const key = decodeURIComponent(rolePerm[1]);
    const r = s.roles.find((x) => x.key === key);
    if (!r || r.built_in) throw new AdminRefused(403, "Built-in roles cannot be changed.");
    const m: Matrix = {};
    for (const res of RESOURCES) {
      m[res] = {};
      for (const a of ACTIONS) m[res][a] = false;
    }
    ((b.permissions as { resource: string; action: string }[]) ?? []).forEach((p) => {
      if (m[p.resource]) m[p.resource][p.action] = true;
    });
    s.matrices[key] = m;
    r.updated_at = NOW;
    return { key, built_in: false, matrix: clone(m) };
  }
  if (path === "/admin/sso") {
    if (method === "DELETE") {
      s.sso = { ...s.sso, configured: false, issuer: "", client_id: "", has_secret: false, display_name: "", allowed_domains: [], enforce: false };
      return clone(s.sso);
    }
    if (method === "PUT") {
      const secretNeeded = !s.sso.has_secret || s.sso.issuer !== b.issuer || s.sso.client_id !== b.client_id;
      if (secretNeeded && !text(b.client_secret).trim()) throw new AdminRefused(422, "Enter the client secret again when the issuer or client ID changes.");
      s.sso = { ...s.sso, configured: true, issuer: text(b.issuer), client_id: text(b.client_id), has_secret: true, display_name: text(b.display_name), allowed_domains: (b.allowed_domains as string[]) ?? [], enforce: b.enforce === true };
      return clone(s.sso);
    }
  }
  if (method === "POST" && path === "/admin/sso/test") {
    const issuer = text(b.issuer) || s.sso.issuer;
    return /^https:\/\//.test(issuer) ? { ok: true, message: `Found the discovery document at ${issuer}/.well-known/openid-configuration.` } : { ok: false, message: "The issuer must start with https://." };
  }
  if (method === "POST" && path === "/admin/api-keys") {
    const grants = ((b.grants as { role_key: string; system_id?: string | null; module?: string | null }[]) ?? []).map((g) => ({ id: nextId("kg"), role_key: g.role_key, role_name: s.roles.find((r) => r.key === g.role_key)?.name ?? g.role_key, system_id: g.system_id ?? null, system_name: g.system_id === SYS_ECC ? "ECC production" : null, module: g.module ?? null }));
    const id = nextId("key");
    const prefix = `mk_${(0xa1b2c3 + s.seq * 977).toString(16).slice(0, 6)}`;
    const key: ApiKey = { id, name: text(b.name), key_prefix: prefix, user_id: nextId("svc"), status: "active", grants, created_by: "u-1", created_by_name: "Nomsa Dlamini", created_at: NOW, expires_at: (b.expires_at as string | null) ?? null, last_used_at: null, revoked_at: null };
    s.keys.unshift(key);
    return { ...clone(key), key: `${prefix}.demo-secret-shown-once-7c1e9a40b2d8` };
  }
  const keyAct = /^\/admin\/api-keys\/([^/]+)(?:\/(revoke))?$/.exec(path);
  if (keyAct) {
    const id = decodeURIComponent(keyAct[1]);
    const k = s.keys.find((x) => x.id === id);
    if (!k) throw new AdminNotFound(path);
    if (keyAct[2] === "revoke") {
      k.status = "revoked";
      k.revoked_at = NOW;
      return clone(k);
    }
    if (method === "DELETE") {
      s.keys = s.keys.filter((x) => x.id !== id);
      return { id, status: "deleted" };
    }
  }
  if (method === "POST" && path === "/licence/validate") {
    s.licence.last_validated = NOW;
    return { ...s.licence, seats_used: seatsUsed() };
  }
  if (method === "POST" && path === "/system/update/trigger") {
    if (s.update.progress === "pulling") throw new AdminRefused(409, "An update is already running.");
    s.update.progress = "done";
    s.update.current_version = s.update.latest_version;
    s.update.update_available = false;
    return { status: "started" };
  }
  if (method === "PUT" && path === "/settings/scoring") {
    Object.assign(s.scoring, clone(b));
    return { status: "ok" };
  }
  if (method === "POST" && path === "/settings/planner") {
    s.planner = clone(b);
    return { status: "ok" };
  }
  if (method === "PUT" && path === "/settings/cost-model") {
    s.cost = clone(b);
    return { status: "ok" };
  }
  if (method === "PATCH" && path === "/settings/alert-thresholds") {
    s.thresholds = clone(b);
    return { status: "ok" };
  }
  if (method === "POST" && path === "/settings/notifications") {
    s.digest = clone(b);
    return { status: "ok" };
  }
  if (method === "PUT" && path === "/settings/retention") {
    s.retention.policy = clone(b);
    s.retention.enforcement = { ...s.retention.enforcement, dry_run_until: "2026-10-27T00:00:00Z", enforced: false };
    return clone(s.retention);
  }
  if (method === "POST" && path === "/settings/retention/preview") return { items: [] };
  const purgeV = /^\/versions\/([^/]+)$/.exec(path);
  if (purgeV && method === "DELETE") {
    const id = decodeURIComponent(purgeV[1]);
    if (text(b.confirm) !== id && text(b.confirm) !== "Run of 28 Aug 2026") throw new AdminRefused(422, "The confirmation does not match the run's label.");
    return { version_id: id, rows_by_table: { findings: 18420 }, bytes_freed: 48_000_000, blocked_reason: null, storage_errors: [], purge_log_id: "pl-2" };
  }
  if (method === "POST" && path === "/admin/purge-tenant") {
    return b.token ? { status: "purged" } : { token: "purge-demo-token", executes_after: new Date(Date.now() + 86_400_000).toISOString() };
  }
  const fm = /^\/field-mappings\/([^/]+)$/.exec(path);
  if (fm && method === "PUT") {
    const m = s.mappings.find((x) => x.id === decodeURIComponent(fm[1]));
    if (!m) throw new AdminNotFound(path);
    Object.assign(m, { customer_field: b.customer_field ?? m.customer_field, customer_label: b.customer_label ?? m.customer_label, notes: b.notes ?? m.notes, is_mapped: b.is_mapped ?? !!(b.customer_field ?? m.customer_field), updated_at: NOW });
    return clone(m);
  }
  if (method === "POST" && path === "/field-mappings/reset") {
    let n = 0;
    s.mappings.forEach((m) => {
      if ((!params.module || m.module === params.module) && (m.customer_field || m.customer_label || m.notes)) {
        m.customer_field = null;
        m.customer_label = null;
        m.notes = null;
        m.is_mapped = false;
        n += 1;
      }
    });
    return { reset_count: n, module: text(params.module) || "all" };
  }
  const refUp = /^\/systems\/([^/]+)\/reference\/(postal-codes|bic)$/.exec(path);
  if (refUp && method === "POST") {
    const id = decodeURIComponent(refUp[1]);
    const lines = text(body).split(/\r?\n/).filter((l) => l.trim());
    const rows = lines.slice(1);
    const countries = [...new Set(rows.map((l) => l.split(",")[0].trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
    const list = { kind: refUp[2], records: rows.length, countries: refUp[2] === "bic" ? [] : countries };
    s.reference[id] = [...(s.reference[id] ?? []).filter((r) => r.kind !== refUp[2]), list];
    return list;
  }
  if (method === "POST" && path === "/alert-channels") {
    const ch: AlertChannel = { id: nextId("ch"), kind: b.kind as AlertChannel["kind"], target: text(b.target).replace(/^https?:\/\//, "").split("/")[0], digest: b.digest as AlertChannel["digest"], report_pack: (b.report_pack as AlertChannel["report_pack"]) ?? "off", immediate_critical: b.immediate_critical === true, enabled: true, created_at: NOW, has_secret: !!b.secret };
    s.channels.push(ch);
    return clone(ch);
  }
  const chId = /^\/alert-channels\/([^/]+)(?:\/(test))?$/.exec(path);
  if (chId) {
    const id = decodeURIComponent(chId[1]);
    const c = s.channels.find((x) => x.id === id);
    if (!c) throw new AdminNotFound(path);
    if (chId[2]) return { delivered: c.enabled };
    if (method === "PUT") {
      Object.assign(c, b);
      return clone(c);
    }
    if (method === "DELETE") {
      s.channels = s.channels.filter((x) => x.id !== id);
      return undefined;
    }
  }
  if (method === "PATCH" && path === "/me/preferences") {
    const merge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
      const out = { ...base };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete out[k];
        else if (typeof v === "object" && !Array.isArray(v)) out[k] = merge((out[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
        else out[k] = v;
      }
      return out;
    };
    s.prefs = merge(s.prefs as Record<string, unknown>, b) as Preferences;
    return clone(s.prefs);
  }
  if (method === "POST" && path === "/me/notifications/test") return { email: "no_backend", in_app: true };
  const hist = /^\/reports\/history\/([^/]+)$/.exec(path);
  if (hist && method === "DELETE") {
    s.history = s.history.filter((h) => h.id !== decodeURIComponent(hist[1]));
    return undefined;
  }
  if (method === "POST" && path === "/reports/schedules") {
    const i = b as unknown as ReportScheduleInput;
    const sch = mkSchedule(nextId("sch"), i, { last: null, lastAt: null, next: "2026-10-27T05:00:00Z" });
    s.schedules.push(sch);
    return clone(sch);
  }
  const sch = /^\/reports\/schedules\/([^/]+)(?:\/(run))?$/.exec(path);
  if (sch) {
    const id = decodeURIComponent(sch[1]);
    const cur = s.schedules.find((x) => x.id === id);
    if (!cur) throw new AdminNotFound(path);
    if (sch[2]) return { queued: true, due_at: NOW };
    if (method === "PUT") {
      const next = mkSchedule(id, b as unknown as ReportScheduleInput, { last: cur.last_status, lastAt: cur.last_run_at, next: cur.next_run_at ?? "2026-10-27T05:00:00Z" });
      s.schedules = s.schedules.map((x) => (x.id === id ? next : x));
      return clone(next);
    }
    if (method === "DELETE") {
      s.schedules = s.schedules.filter((x) => x.id !== id);
      return undefined;
    }
  }
  if (method === "POST" && path === "/migration/waves") {
    if (s.waves.some((w) => w.name === b.name)) throw new AdminRefused(409, `A wave named '${text(b.name)}' already exists.`);
    const w = wave(nextId("w"), text(b.name), (b.modules as string[]) ?? [], (b.target_date as string | null) ?? null, (b.stage as MigrationWave["stage"]) ?? "plan", { v: null, s: null });
    w.min_readiness = Number(b.min_readiness ?? 95);
    s.waves.push(w);
    return clone(w);
  }
  const so = /^\/migration\/waves\/([^/]+)\/signoff$/.exec(path);
  if (so && method === "POST") {
    const w = s.waves.find((x) => x.id === decodeURIComponent(so[1]));
    if (!w) throw new AdminNotFound(path);
    if (w.signed_off_at) throw new AdminRefused(409, "This wave is already signed off.");
    Object.assign(w, { signed_off_by: "u-me", signed_off_at: NOW, updated_at: NOW });
    return clone(w);
  }
  const wv = /^\/migration\/waves\/([^/]+)$/.exec(path);
  if (wv) {
    const id = decodeURIComponent(wv[1]);
    const w = s.waves.find((x) => x.id === id);
    if (!w) throw new AdminNotFound(path);
    if (method === "PATCH") {
      Object.assign(w, b, { updated_at: NOW, signed_off_by: null, signed_off_at: null });
      return clone(w);
    }
    if (method === "DELETE") {
      s.waves = s.waves.filter((x) => x.id !== id);
      return undefined;
    }
  }
  return NONE_ADMIN;
}

/** A file the screen downloads in fixture mode: a short text stand-in, and a row in the report history for a report. */
export function fixtureDownload(path: string, params: Record<string, unknown>, fallback: string): { name: string; text: string } {
  const s = st();
  if (path === "/audit/export") {
    const rows = filterAudit(params);
    const head = "time,actor,action,object,method,path,status";
    return { name: fallback, text: [head, ...rows.map((e) => [e.created_at, e.actor_email, e.action, e.entity_id, e.method, e.path, e.status_code].join(","))].join("\n") };
  }
  const hist = /^\/reports\/history\/([^/]+)\/download$/.exec(path);
  if (hist) {
    const f = s.history.find((h) => h.id === decodeURIComponent(hist[1]));
    return { name: f?.file_name ?? fallback, text: `Fixture copy of ${f?.name ?? "the report"}.\n` };
  }
  if (path.startsWith("/reports/")) {
    const kind = path.includes("/board/") ? "board" : path.includes("workbook") ? "workbook" : path.includes("/analysis/") ? "analysis" : path.includes("/object/") ? "object" : (/\/reports\/([a-z]+)\./.exec(path)?.[1] ?? "report");
    const def = CATALOGUE.find((c) => c.id === kind);
    const ext = def?.format.toLowerCase() ?? "pdf";
    const n = s.history.length + 1;
    const file: ReportFile = { id: nextId("rf"), kind, name: def?.name ?? "Report", version_id: text(params.version_id) || "d3229ded-0708-4967-9dfb-1b7f4fada953", run_label: "Run of 16 Oct 2026", run_at: "2026-10-16T05:17:00Z", format: ext as ReportFile["format"], file_name: `${kind}-fixture-${n}.${ext}`, size_bytes: 1_250_000, source: "download", schedule_id: null, created_by: "u-1", created_by_label: "Demo user", created_at: NOW, can_delete: true };
    s.history.unshift(file);
    return { name: file.file_name, text: `Fixture ${def?.name ?? "report"} (${ext}).\n` };
  }
  return { name: fallback, text: "Fixture file.\n" };
}
