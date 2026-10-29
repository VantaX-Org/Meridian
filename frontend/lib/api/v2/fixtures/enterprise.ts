/**
 * Fixture answers for the enterprise screens (`?fixture=1`): the tenant theme, the status page, the diagnostics
 * summary, the compliance statement and SCIM provisioning, in the backend's shapes (api/routes/theme.py,
 * status_page.py, diagnostics.py, compliance.py, scim_admin.py) and with its refusals as `{detail}`. State is in
 * memory so a write shows in the next read; `resetEnterpriseFixture()` restores it for tests. Values are invented for
 * the demo tenant and stable, so screenshots repeat.
 */
import type { ComplianceStatement, PublicTheme, RetentionInput, ScimMappings, ScimTokenStatus, StatusPage, ThemeInput, ThemeSettings } from "../enterprise";
import { LOGO_MAX_BYTES, LOGO_TYPES, RETENTION_FIELD, RETENTION_MAX, RETENTION_MIN } from "../enterprise";

export const NONE_ENTERPRISE = Symbol("no-enterprise-fixture");

const NOW = "2026-10-20T08:00:00Z";
const DAY = 86_400_000;

class Refused extends Error {
  response: { status: number; data: { detail: string } };
  constructor(status: number, detail: string) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}

/* ── Theme: the server's product defaults and checks (api/routes/theme.py, api/services/theme.py), mirrored ── */

const DEFAULT_ACCENT = `#${"2563EB"}`;
const DEFAULT_ACCENT_DARK = `#${"7FA8FF"}`;
/** Relative luminance of the server's dark ground (api/services/theme.py DARK_GROUND). */
const SERVER_DARK_GROUND = 0.007061543;
const PRODUCT_NAME_MAX = 40;
const HEX = /^#?([0-9a-fA-F]{6})$/;

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const norm = (v: string): string => {
  const m = HEX.exec(v.trim());
  if (!m) throw new Refused(422, `Use a hex colour such as ${DEFAULT_ACCENT}`);
  return `#${m[1].toUpperCase()}`;
};
const mixWhite = (hex: string, t: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface StoredTheme {
  product_name_override: string | null;
  accent: string | null;
  accent_dark: string | null;
  logo: { url: string; content_type: string } | null;
  updated_at: string | null;
}

function settingsView(t: StoredTheme): ThemeSettings {
  return {
    product_name_override: t.product_name_override,
    accent: t.accent,
    accent_dark: t.accent_dark,
    logo_url: t.logo?.url ?? null,
    logo_content_type: t.logo?.content_type ?? null,
    contrast: { on_white: t.accent ? round2(contrast(lum(t.accent), 1)) : null, on_dark: t.accent_dark ? round2(contrast(lum(t.accent_dark), SERVER_DARK_GROUND)) : null },
    updated_at: t.updated_at,
  };
}

function publicView(t: StoredTheme): PublicTheme {
  return {
    product_name: t.product_name_override || "Meridian",
    accent: t.accent || DEFAULT_ACCENT,
    accent_dark: t.accent_dark || DEFAULT_ACCENT_DARK,
    logo_url: t.logo?.url ?? null,
    customised: Boolean(t.product_name_override || t.accent || t.logo),
  };
}

function putTheme(cur: StoredTheme, b: ThemeInput): StoredTheme {
  let name: string | null = null;
  if (b.product_name_override != null) {
    const clean = b.product_name_override.split(/\s+/).filter(Boolean).join(" ");
    if (clean.length > PRODUCT_NAME_MAX) throw new Refused(422, `Keep the product name to ${PRODUCT_NAME_MAX} characters`);
    if (/[<>]/.test(clean)) throw new Refused(422, "The product name cannot contain < or >");
    name = clean || null;
  }
  if (b.accent_dark && !b.accent) throw new Refused(422, "Set the accent before a dark-mode accent");
  let accent: string | null = null;
  let dark: string | null = null;
  if (b.accent) {
    accent = norm(b.accent);
    const onWhite = contrast(lum(accent), 1);
    if (onWhite < 4.5) throw new Refused(422, `The accent ${accent} has ${onWhite.toFixed(2)}:1 contrast against white; it needs at least 4.5:1. Choose a darker colour.`);
    if (b.accent_dark) dark = norm(b.accent_dark);
    else {
      dark = mixWhite(accent, 1);
      for (let s = 0; s <= 20; s++) {
        const c = mixWhite(accent, s / 20);
        if (contrast(lum(c), SERVER_DARK_GROUND) >= 4.5) {
          dark = c;
          break;
        }
      }
    }
    const onDark = contrast(lum(dark), SERVER_DARK_GROUND);
    if (onDark < 4.5) throw new Refused(422, `The dark-mode accent ${dark} has ${onDark.toFixed(2)}:1 contrast against the dark ground; it needs at least 4.5:1. Choose a lighter colour.`);
  }
  let logo = cur.logo;
  if (b.logo_url === null) logo = null;
  else if (b.logo_url !== (cur.logo?.url ?? null)) throw new Refused(422, "Upload the logo with POST /api/v1/settings/theme/logo");
  return { product_name_override: name, accent, accent_dark: dark, logo, updated_at: NOW };
}

function uploadLogo(cur: StoredTheme, body: unknown, seq: number): StoredTheme {
  const file = typeof FormData !== "undefined" && body instanceof FormData ? body.get("file") : null;
  if (!file || typeof file === "string") throw new Refused(422, "The file is empty");
  if (file.size === 0) throw new Refused(422, "The file is empty");
  if (file.size > LOGO_MAX_BYTES) throw new Refused(422, `The logo is larger than ${LOGO_MAX_BYTES / 1024} KB`);
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new Refused(422, "The file is not a PNG or SVG image");
  // The server answers a same-origin URL that serves the stored bytes; with no server, the fixture serves the file
  // from the browser's memory when it can.
  const url = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : `/api/v1/theme/logo?v=fixture${seq}`;
  return { ...cur, logo: { url, content_type: file.type }, updated_at: NOW };
}

/* ── Status page ── */

/**
 * The status page is generated now, as the server does, so the page's minute refresh shows a new time. Samples every
 * 5 minutes for the 30 UTC days to today; 18 days ago lost 18 slots (degraded), 6 days ago 160 (an outage).
 */
function uptime(now: number): StatusPage["uptime"] {
  const perDay = 288;
  const lost: Record<number, number> = { 18: 18, 6: 160 };
  const end = Math.floor(now / DAY) * DAY;
  const byDay = [];
  for (let d = 29; d >= 0; d--) {
    const slots = d === 0 ? 97 : perDay;
    const up = slots - (lost[d] ?? 0);
    byDay.push({ date: new Date(end - d * DAY).toISOString().slice(0, 10), slots, uptime_pct: Math.round((100_000 * up) / slots) / 1000 });
  }
  const slots = byDay.reduce((s, d) => s + d.slots, 0);
  const lostAll = Object.values(lost).reduce((s, n) => s + n, 0);
  const comp = (id: string, label: string, down: number) => ({ id, label, samples: slots, uptime_pct: Math.round((100_000 * (slots - down)) / slots) / 1000 });
  return {
    days: 30,
    sample_minutes: 5,
    overall_pct: Math.round((100_000 * (slots - lostAll)) / slots) / 1000,
    slots,
    components: [comp("api", "API", 160), comp("db", "Database", 160), comp("garage", "Object storage", 0), comp("redis", "Cache and queue", 18), comp("workers", "Background workers", 178)],
    by_day: byDay,
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

function statusPage(): StatusPage {
  const now = Date.now();
  return {
  status: "degraded",
  generated_at: iso(now),
  components: [
    { id: "api", label: "API", status: "up", latency_ms: 0, detail: null, data: {} },
    { id: "db", label: "Database", status: "up", latency_ms: 4, detail: null, data: {} },
    { id: "redis", label: "Cache and queue", status: "up", latency_ms: 2, detail: null, data: {} },
    { id: "workers", label: "Background workers", status: "degraded", latency_ms: 41, detail: "140 tasks waiting", data: { online: 3, queues: { celery: 140 } } },
    { id: "garage", label: "Object storage", status: "up", latency_ms: 9, detail: null, data: {} },
    { id: "ollama", label: "Local AI model", status: "not_configured", latency_ms: null, detail: null, data: {} },
  ],
  incidents: [
    { reference: "ERR-7F3A91", count: 3, first_seen: iso(now - 7 * 3_600_000), last_seen: iso(now - 80 * 60_000), areas: ["GET /api/v1/landscape"] },
    { reference: "ERR-C20B44", count: 1, first_seen: iso(now - 21 * 3_600_000), last_seen: iso(now - 21 * 3_600_000), areas: ["GET /api/v1/work", "POST /api/v1/work"] },
  ],
  maintenance: [{ id: "f1d2", title: "Database upgrade", starts_at: "2027-01-16T20:00:00+00:00", ends_at: "2027-01-16T22:00:00+00:00", detail: "Screens may be unavailable for up to 20 minutes.", in_progress: false }],
  uptime: uptime(now),
  };
}

/* ── Diagnostics ── */

/** GET /support/diagnostics: the summary part of the bundle, in the backend's shape (api/routes/diagnostics.py). */
const diagnostics = (): Record<string, unknown> => ({
  generated_at: NOW,
  tenant_id: "00000000-0000-4000-8000-000000000001",
  versions: { api: "0.1.1", frontend: "0.1.1", migrations_head: "099" },
  licence: { valid: true, status: "active", tier: "enterprise", expiry_date: "2027-06-30", seats_used: 41, seat_limit: 50 },
  users: { total: 44, active: 41, service_accounts: 2, without_password: 6, scim_provisioned: 2 },
  systems: { count: 3, by_type: { ecc: 2, s4hana_cloud: 1 }, by_health: { healthy: 2, degraded: 1 } },
  jobs: { count: 14, by_status: { done: 11, running: 1, failed: 2 } },
  server_errors: { last_24h: 4, references_24h: 2, latest: { reference: "ERR-7F3A91", at: "2026-10-20T06:40:00Z", path: "/api/v1/landscape" } },
  health: { status: "degraded", components: statusPage().components },
  health_samples_24h: 288,
  environment: { env: "production", auth_mode: "local", licence_mode: "online", llm_provider: "ollama", api_workers: 4, live_writeback_enabled: false, purge_enabled: false, credential_master_key_set: true, llm_kek_set: true, sentry_configured: false, updater_configured: true, email_backend: "smtp" },
});

/* ── Compliance ── */

interface Policy {
  versions_days: number | null;
  reports_days: number | null;
  audit_days: number | null;
}

function compliance(p: Policy): ComplianceStatement {
  return {
    generated_at: NOW,
    data_residency: { deployment: "customer_hosted", database_host: "postgres", object_storage_host: "garage", llm_provider: "ollama", llm_in_deployment: true },
    retention: {
      families: [
        { family: "analysis_versions", label: "Analysis runs, findings and work lists", days: p.versions_days, configurable: true },
        { family: "reports", label: "Generated reports", days: p.reports_days, configurable: true },
        { family: "audit_log", label: "Audit log", days: p.audit_days, configurable: true },
        { family: "health_samples", label: "Health samples", days: 35, configurable: false },
        { family: "jobs", label: "Job progress", days: 7, configurable: false },
      ],
      keep_baseline: true,
      keep_latest_per_system: 1,
      enforcement: { flag_enabled: true, dry_run_until: "2026-10-27T02:00:00+00:00", enforced: false },
    },
    encryption_at_rest: { database_volume: true, object_storage: null, sap_credentials: true, llm_api_keys: true },
    backup: { at: "2026-10-20T02:10:00Z", migration_head: "099", database_only: false, env_encrypted: true },
  };
}

/* ── SCIM ── */

const BASE_URL = "https://meridian.demo-corp.example/scim/v2";

interface Token {
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const tokenView = (t: Token | null): ScimTokenStatus =>
  t ? { configured: true, token_prefix: t.prefix, created_at: t.created_at, last_used_at: t.last_used_at, base_url: BASE_URL } : { configured: false, token_prefix: null, created_at: null, last_used_at: null, base_url: BASE_URL };

/** Roles the fixture tenant has (fixtures/admin.ts) and their names, as the server joins them. */
const ROLE_NAME: Record<string, string> = { platform_admin: "Platform admin", programme_lead: "Programme lead / CIO", data_steward: "Data steward", data_owner: "Data owner / approver", analyst: "Analyst", sap_basis: "SAP Basis / integration admin", auditor: "Auditor", viewer: "Viewer", finance_reviewer: "Finance reviewer" };
/** Groups the identity provider has sent, with their member counts. */
const GROUPS: Record<string, number> = { "sap-dq-stewards": 6, "sap-dq-owners": 3 };

function mapping(group: string, role: string): ScimMappings["mappings"][number] {
  const key = group.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  return { group, role, role_name: ROLE_NAME[role] ?? role, group_exists: key in GROUPS, members: GROUPS[key] ?? 0 };
}

/* ── State ── */

interface State {
  theme: StoredTheme;
  policy: Policy;
  token: Token | null;
  mappings: { group: string; role: string }[];
  seq: number;
}

function build(): State {
  return {
    theme: { product_name_override: null, accent: null, accent_dark: null, logo: null, updated_at: null },
    policy: { versions_days: 365, reports_days: 180, audit_days: 2555 },
    token: { prefix: "mscim_5f3a91c2...b1a7", created_at: "2026-09-02T09:30:00+00:00", last_used_at: "2026-10-20T07:41:00+00:00" },
    mappings: [
      { group: "SAP-DQ-Owners", role: "data_owner" },
      { group: "SAP-DQ-Stewards", role: "data_steward" },
      { group: "SAP-Basis", role: "sap_basis" },
    ],
    seq: 0,
  };
}

let state = build();
export const resetEnterpriseFixture = (): void => {
  state = build();
};

const mappingsView = (): ScimMappings => ({ mappings: [...state.mappings].sort((a, b) => a.group.toLowerCase().localeCompare(b.group.toLowerCase())).map((m) => mapping(m.group, m.role)) });

/** A read in fixture mode, or NONE_ENTERPRISE when the path is not one of these. */
export function enterpriseFixtureResponse(path: string): unknown {
  if (path === "/theme") return publicView(state.theme);
  if (path === "/settings/theme") return settingsView(state.theme);
  if (path === "/status/page") return statusPage();
  if (path === "/support/diagnostics") return diagnostics();
  if (path === "/settings/compliance") return compliance(state.policy);
  if (path === "/admin/scim/token") return tokenView(state.token);
  if (path === "/admin/scim/group-roles") return mappingsView();
  return NONE_ENTERPRISE;
}

/** A write in fixture mode, or NONE_ENTERPRISE. Refusals carry the API's `{detail}`. */
export function enterpriseFixtureWrite(method: string, path: string, body: unknown): unknown {
  if (method === "PUT" && path === "/settings/theme") {
    state.theme = putTheme(state.theme, body as ThemeInput);
    return settingsView(state.theme);
  }
  if (method === "POST" && path === "/settings/theme/logo") {
    state.seq += 1;
    state.theme = uploadLogo(state.theme, body, state.seq);
    return settingsView(state.theme);
  }
  if (method === "PUT" && path === "/settings/compliance") {
    const r = ((body ?? {}) as { retention?: RetentionInput }).retention ?? {};
    const next = { ...state.policy };
    for (const field of Object.values(RETENTION_FIELD)) {
      if (!(field in r)) continue;
      const v = r[field];
      if (v != null && (!Number.isInteger(v) || v < RETENTION_MIN[field] || v > RETENTION_MAX)) throw new Refused(422, `retention.${field}: Input should be between ${RETENTION_MIN[field]} and ${RETENTION_MAX}`);
      next[field] = v ?? null;
    }
    state.policy = next;
    return compliance(state.policy);
  }
  if (method === "POST" && path === "/admin/scim/token") {
    const action = ((body ?? {}) as { action?: string }).action ?? "rotate";
    if (action === "revoke") {
      if (!state.token) throw new Refused(404, "There is no SCIM token to revoke");
      state.token = null;
      return tokenView(null);
    }
    state.seq += 1;
    const raw = `${(0x5f3a91c2 + state.seq * 7919).toString(16)}d4e8b1a7c3f2${state.seq}`;
    state.token = { prefix: `mscim_${raw.slice(0, 8)}...${raw.slice(-4)}`, created_at: NOW, last_used_at: null };
    return { ...tokenView(state.token), token: `mscim_${raw}` };
  }
  if (method === "PUT" && path === "/admin/scim/group-roles") {
    const list = ((body ?? {}) as { mappings?: { group: string; role: string }[] }).mappings ?? [];
    const seen = new Set<string>();
    for (const m of list) {
      const key = m.group.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
      if (!key) throw new Refused(422, "Name each group");
      if (seen.has(key)) throw new Refused(422, `The group ${m.group} is mapped twice`);
      if (!(m.role in ROLE_NAME)) throw new Refused(422, `Unknown or retired role: ${m.role}`);
      seen.add(key);
    }
    state.mappings = list.map((m) => ({ group: m.group.split(/\s+/).filter(Boolean).join(" "), role: m.role }));
    const resynced = state.mappings.reduce((s, m) => s + (GROUPS[m.group.toLowerCase()] ?? 0), 0);
    return { ...mappingsView(), resynced_users: resynced };
  }
  return NONE_ENTERPRISE;
}

/** The zip in fixture mode: a text stand-in with the summary inside. */
export function enterpriseFixtureDownload(path: string): { name: string; text: string } | null {
  if (path === "/support/diagnostics.zip") return { name: "meridian-diagnostics-fixture.zip", text: `${JSON.stringify(diagnostics(), null, 2)}\n` };
  return null;
}
