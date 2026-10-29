/**
 * Fixture answers for the enterprise screens (`?fixture=1`): the tenant theme, the status page, the diagnostics
 * summary, compliance settings and SCIM provisioning. State is in memory so a write shows in the next read;
 * `resetEnterpriseFixture()` restores it for tests. Values are invented for the demo tenant and stable, so
 * screenshots repeat.
 */
import type { ComplianceSettings, ScimGroupRoles, ScimToken, StatusPage, TenantTheme } from "../enterprise";

export const NONE_ENTERPRISE = Symbol("no-enterprise-fixture");

const NOW = "2026-10-20T08:00:00Z";
const DAY = 86_400_000;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

class Refused extends Error {
  response: { status: number; data: { detail: string } };
  constructor(status: number, detail: string) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}

/** Four probes a day (01:00 to 07:00 UTC) for thirty days to 20 October; 2 October had a slow hour, 14 October an outage. */
function samples(): { at: string; ok: boolean }[] {
  const out: { at: string; ok: boolean }[] = [];
  const last = Date.UTC(2026, 9, 20);
  for (let d = 29; d >= 0; d--) {
    for (let h = 0; h < 4; h++) {
      const at = new Date(last - d * DAY + (1 + h * 2) * 3_600_000);
      const ok = !(d === 6 && h < 3) && !(d === 18 && h === 2);
      out.push({ at: at.toISOString(), ok });
    }
  }
  return out;
}

interface State {
  theme: TenantTheme;
  compliance: ComplianceSettings;
  token: ScimToken;
  groups: ScimGroupRoles;
  seq: number;
}

function build(): State {
  return {
    theme: { logo_url: null, product_name: null, accent: null },
    compliance: {
      residency: { host: "meridian.demo-corp.example", region: "eu-central-1" },
      retention: [
        { family: "runs", days: 365 },
        { family: "reports", days: 180 },
        { family: "audit", days: 2555 },
        { family: "diagnostics", days: 30 },
      ],
      encryption_at_rest: true,
      last_backup_at: "2026-10-20T02:10:00Z",
    },
    token: { created_at: "2026-09-02T09:30:00Z", last_used_at: "2026-10-20T07:41:00Z", revoked: false },
    groups: {
      map: [
        { group: "SAP-DQ-Stewards", role: "data_steward" },
        { group: "SAP-DQ-Owners", role: "data_owner" },
        { group: "SAP-Basis", role: "sap_basis" },
      ],
    },
    seq: 0,
  };
}

let state = build();
export const resetEnterpriseFixture = (): void => {
  state = build();
};

const statusPage = (): StatusPage => ({
  components: [
    { name: "API", status: "ok", detail: "Answering in 42 ms at the 95th percentile.", measured_at: "2026-10-20T07:59:00Z" },
    { name: "Database", status: "ok", detail: "Primary in sync; 18 connections of 100 in use.", measured_at: "2026-10-20T07:59:00Z" },
    { name: "Background workers", status: "degraded", detail: "2 of 3 workers answering; queued jobs wait longer than usual.", measured_at: "2026-10-20T07:58:00Z" },
    { name: "Object storage", status: "ok", detail: null, measured_at: "2026-10-20T07:59:00Z" },
    { name: "Licence service", status: "ok", detail: "Validated 2 hours ago.", measured_at: "2026-10-20T06:00:00Z" },
  ],
  incidents: [
    { reference: "INC-7F3A91", first_seen: "2026-10-14T01:05:00Z", last_seen: "2026-10-14T13:40:00Z", count: 37, path: "/api/v1/landscape" },
    { reference: "INC-C20B44", first_seen: "2026-10-02T10:12:00Z", last_seen: "2026-10-02T10:31:00Z", count: 4, path: "/api/v1/work/records" },
  ],
  maintenance: { from: "2027-01-16T20:00:00Z", to: "2027-01-16T22:00:00Z", note: "Database upgrade. Screens may be unavailable for up to 20 minutes." },
  uptime_30d_pct: 99.82,
  samples: samples(),
});

/** GET /support/diagnostics: the summary part of the bundle, in the backend's shape (api/routes/diagnostics.py). */
const diagnostics = (): Record<string, unknown> => ({
  generated_at: NOW,
  tenant_id: "00000000-0000-4000-8000-000000000001",
  versions: { api: "0.1.1", frontend: "0.1.1", migrations_head: "099" },
  licence: { valid: true, status: "active", tier: "enterprise", expiry_date: "2027-06-30", seats_used: 41, seat_limit: 50 },
  users: { total: 44, active: 41, service_accounts: 2, without_password: 6, scim_provisioned: 2 },
  systems: { count: 3, by_type: { ecc: 2, s4hana_cloud: 1 }, by_health: { healthy: 2, degraded: 1 } },
  jobs: { count: 14, by_status: { done: 11, running: 1, failed: 2 } },
  server_errors: { last_24h: 3, references_24h: 2, latest: { reference: "ERR-7F3A21", at: "2026-10-16T04:12:00Z", path: "/api/v1/work" } },
  health: {
    status: "degraded",
    components: [
      { id: "api", label: "API", status: "up", latency_ms: 0, detail: null, data: {} },
      { id: "db", label: "Database", status: "up", latency_ms: 4, detail: null, data: {} },
      { id: "redis", label: "Cache and queue", status: "up", latency_ms: 2, detail: null, data: {} },
      { id: "workers", label: "Background workers", status: "degraded", latency_ms: 41, detail: "queue celery holds 140 tasks", data: { celery: 140 } },
      { id: "garage", label: "Object storage", status: "up", latency_ms: 9, detail: null, data: {} },
    ],
  },
  health_samples_24h: 96,
  environment: { env: "production", auth_mode: "local", licence_mode: "online", llm_provider: "ollama", api_workers: 4, live_writeback_enabled: false, purge_enabled: false, credential_master_key_set: true, llm_kek_set: true, sentry_configured: false, updater_configured: true, email_backend: "smtp" },
});

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A read in fixture mode, or NONE_ENTERPRISE when the path is not one of these. */
export function enterpriseFixtureResponse(path: string): unknown {
  if (path === "/theme" || path === "/settings/theme") return clone(state.theme);
  if (path === "/status/page") return statusPage();
  if (path === "/support/diagnostics") return diagnostics();
  if (path === "/settings/compliance") return clone(state.compliance);
  if (path === "/admin/scim/token") {
    const { token: _secret, ...rest } = state.token;
    void _secret;
    return clone(rest);
  }
  if (path === "/admin/scim/group-roles") return clone(state.groups);
  return NONE_ENTERPRISE;
}

/** A write in fixture mode, or NONE_ENTERPRISE. Refusals carry the API's `{detail}`. */
export function enterpriseFixtureWrite(method: string, path: string, body: unknown): unknown {
  if (method === "PUT" && path === "/settings/theme") {
    const b = (body ?? {}) as Partial<TenantTheme>;
    if (b.accent != null && !HEX.test(b.accent)) throw new Refused(422, "The accent must be a colour written #rrggbb.");
    if (b.product_name != null && b.product_name.length > 60) throw new Refused(422, "The product name must be 60 characters or fewer.");
    if (b.logo_url != null && b.logo_url.length > 400_000) throw new Refused(413, "The logo must be 256 KB or smaller.");
    state.theme = { logo_url: b.logo_url ?? null, product_name: b.product_name?.trim() || null, accent: b.accent ?? null };
    return clone(state.theme);
  }
  if (method === "PUT" && path === "/settings/compliance") {
    const b = body as ComplianceSettings;
    const bad = (b.retention ?? []).find((r) => !Number.isInteger(r.days) || r.days < 1 || r.days > 3650);
    if (bad) throw new Refused(422, `Retention for ${bad.family} must be a whole number of days from 1 to 3650.`);
    state.compliance = { ...state.compliance, retention: clone(b.retention) };
    return clone(state.compliance);
  }
  if (method === "POST" && path === "/admin/scim/token") {
    state.seq += 1;
    const secret = `scim_${(0x5f3a91c2 + state.seq * 7919).toString(16)}${"d4e8b1a7c3f2".slice(0, 12)}${state.seq}`;
    state.token = { created_at: NOW, last_used_at: null, revoked: false };
    return { ...clone(state.token), token: secret };
  }
  if (method === "DELETE" && path === "/admin/scim/token") {
    state.token = { ...state.token, revoked: true };
    return clone(state.token);
  }
  if (method === "PUT" && path === "/admin/scim/group-roles") {
    const b = body as ScimGroupRoles;
    const names = (b.map ?? []).map((m) => m.group.trim().toLowerCase());
    if (names.some((n) => !n)) throw new Refused(422, "Every row needs a group name.");
    if (new Set(names).size !== names.length) throw new Refused(422, "A group can map to one role only.");
    state.groups = { map: (b.map ?? []).map((m) => ({ group: m.group.trim(), role: m.role })) };
    return clone(state.groups);
  }
  return NONE_ENTERPRISE;
}

/** The zip in fixture mode: a text stand-in with the summary inside. */
export function enterpriseFixtureDownload(path: string): { name: string; text: string } | null {
  if (path === "/support/diagnostics.zip") return { name: "meridian-diagnostics-fixture.zip", text: `${JSON.stringify(diagnostics(), null, 2)}\n` };
  return null;
}
