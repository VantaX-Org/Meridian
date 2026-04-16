/**
 * Meridian Licence Worker — Cloudflare Worker
 *
 * Public endpoints:
 *   POST /api/licence/validate            — validate key, return full manifest
 *   GET  /api/licence/heartbeat           — health check
 *   POST /api/licence/field-mappings/sync — receive field mapping updates from customer
 *
 * Auth:
 *   POST /api/admin/login                 — email + password → JWT
 *
 * Admin endpoints (require Authorization: Bearer <jwt>):
 *   GET    /api/admin/analytics
 *   GET    /api/admin/tenants
 *   POST   /api/admin/tenants
 *   GET    /api/admin/tenants/:id
 *   PUT    /api/admin/tenants/:id
 *   PATCH  /api/admin/tenants/:id
 *   DELETE /api/admin/tenants/:id
 *   POST   /api/admin/tenants/:id/regenerate-key
 *   POST   /api/admin/tenants/:id/offline-token
 *   GET    /api/admin/tenants/:id/field-mappings
 *   PUT    /api/admin/tenants/:id/field-mappings
 *   GET    /api/admin/rules
 *   POST   /api/admin/rules
 *   POST   /api/admin/rules/import
 *   GET    /api/admin/rules/:id
 *   PUT    /api/admin/rules/:id
 *   PATCH  /api/admin/rules/:id
 *   DELETE /api/admin/rules/:id
 */

interface Env {
  LICENCE_KV: KVNamespace;
  DB: D1Database;
  /** Admin login email — set via wrangler secret put ADMIN_EMAIL */
  ADMIN_EMAIL: string;
  /** SHA-256 hex of the admin password — set via wrangler secret put ADMIN_PASSWORD_HASH */
  ADMIN_PASSWORD_HASH: string;
  /** HMAC-SHA-256 signing secret for admin JWTs — set via wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** RSA-PKCS8 private key PEM for offline JWT signing (set as Worker secret) */
  OFFLINE_JWT_PRIVATE_KEY?: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TenantFeatures {
  ask_meridian: boolean;
  export_reports: boolean;
  run_sync: boolean;
  field_mapping_self_service: boolean;
  max_users: number;
}

interface LlmConfig {
  tier: 1 | 2 | 3;
  model: string;
  notes: string;
}

interface TenantRow {
  id: string;
  company_name: string;
  contact_email: string;
  licence_key_hash: string | null;
  licence_key_suffix: string | null;
  tier: string;
  status: string;
  expiry_date: string;
  enabled_modules: string;
  enabled_menu_items: string;
  features: string;
  llm_config: string;
  machine_fingerprint: string | null;
  last_ping: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  module: string;
  category: string;
  severity: string;
  enabled: number;
  conditions: string;
  thresholds: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface FieldMappingRow {
  id: string;
  tenant_id: string;
  module: string;
  standard_field: string;
  standard_label: string | null;
  customer_field: string | null;
  customer_label: string | null;
  data_type: string;
  is_mapped: number;
  notes: string | null;
  updated_at: string;
}

interface TenantUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateLicenceKey(): string {
  const seg = () => {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  };
  return `MRDX-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}

async function hashKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function cors(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, { status: response.status, headers });
}

function json<T>(data: T, status = 200): Response {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

// ─── JWT (HMAC-SHA256) ────────────────────────────────────────────────────────

function b64url(data: string): string {
  return btoa(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}

async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(b64urlDecode(sigB64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(signingInput)
  );
  if (!valid) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────

async function requireAdmin(
  request: Request,
  env: Env
): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
  return null;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseTenant(row: TenantRow) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_email: row.contact_email,
    licence_key_masked: row.licence_key_suffix ? `MRDX-****-****-${row.licence_key_suffix}` : null,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    enabled_modules: JSON.parse(row.enabled_modules || "[]") as string[],
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
    machine_fingerprint: row.machine_fingerprint,
    last_ping: row.last_ping,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseRule(row: RuleRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    module: row.module,
    category: row.category,
    severity: row.severity,
    enabled: row.enabled === 1,
    conditions: JSON.parse(row.conditions || "[]"),
    thresholds: JSON.parse(row.thresholds || "{}"),
    tags: JSON.parse(row.tags || "[]") as string[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseFieldMapping(row: FieldMappingRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    module: row.module,
    standard_field: row.standard_field,
    standard_label: row.standard_label,
    customer_field: row.customer_field,
    customer_label: row.customer_label,
    data_type: row.data_type,
    is_mapped: row.is_mapped === 1,
    notes: row.notes,
    updated_at: row.updated_at,
  };
}

function daysRemaining(expiryDate: string): number {
  const diff = new Date(expiryDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MENU_ITEMS = [
  "dashboard", "findings", "versions", "analytics", "import", "sync",
  "reports", "stewardship", "contracts", "ask_meridian", "export",
  "user_management", "settings", "licence",
];

const DEFAULT_FEATURES: TenantFeatures = {
  ask_meridian: true,
  export_reports: true,
  run_sync: true,
  field_mapping_self_service: false,
  max_users: 20,
};

const TIER_MODULES: Record<string, string[]> = {
  starter: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
  ],
  professional: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  enterprise: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management",
    "wm_interface", "cross_system_integration",
  ],
};

// ─── Auth Handler ─────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }

  if (body.email !== env.ADMIN_EMAIL) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  const passwordHash = await hashKey(body.password);
  if (passwordHash !== env.ADMIN_PASSWORD_HASH) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: body.email,
      role: "admin",
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60, // 8 hours
    },
    env.JWT_SECRET
  );

  return json({ token, expiresIn: 8 * 60 * 60 });
}

// ─── Offline Token Generation ─────────────────────────────────────────────────

async function handleGenerateOfflineToken(
  tenantId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  if (!env.OFFLINE_JWT_PRIVATE_KEY) {
    return json(
      { error: "not_configured", message: "OFFLINE_JWT_PRIVATE_KEY secret is not set" },
      503
    );
  }

  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!row) return json({ error: "not_found" }, 404);

  const body = (await request.json().catch(() => ({}))) as { expiryDays?: number };
  const expiryDays = Math.min(Math.max(Number(body.expiryDays) || 365, 1), 1095);

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + expiryDays * 86400;
  const expiresAt = new Date(exp * 1000).toISOString();

  const rulesResult = await env.DB.prepare(
    "SELECT * FROM rules WHERE enabled = 1 ORDER BY module, category"
  ).all<RuleRow>();
  const rules = (rulesResult.results || []).map(parseRule);

  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ?"
  )
    .bind(tenantId)
    .all<FieldMappingRow>();
  const fieldMappings = (mappingsResult.results || []).map(parseFieldMapping);

  const payload = {
    iss: "meridian-hq",
    sub: tenantId,
    iat: nowSec,
    exp,
    tenant_id: tenantId,
    enabled_modules: JSON.parse(row.enabled_modules || "[]") as string[],
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
    rules,
    field_mappings: fieldMappings,
  };

  const keyPem = env.OFFLINE_JWT_PRIVATE_KEY.trim();
  const pemBody = keyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const headerB64 = encode({ alg: "RS256", typ: "JWT" });
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return json({ token: `${signingInput}.${sig}`, expiresAt, expiryDays });
}

// ─── Licence Validation ───────────────────────────────────────────────────────

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { licenceKey?: string; machineFingerprint?: string };
  const { licenceKey, machineFingerprint } = body;

  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }

  const keyHash = await hashKey(licenceKey);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<TenantRow>();

  if (!row) {
    // Fallback to legacy KV
    const kv = (await env.LICENCE_KV.get(`licence:${licenceKey}`, "json")) as {
      modules: string[];
      features: string[];
      expiresAt: string;
      tenantId: string;
      active: boolean;
    } | null;
    if (!kv || !kv.active) return json({ valid: false, reason: "invalid_key" }, 403);
    if (new Date(kv.expiresAt) < new Date()) return json({ valid: false, reason: "expired" }, 403);
    await env.LICENCE_KV.put(
      `ping:${licenceKey}`,
      JSON.stringify({ lastSeen: nowIso(), machineFingerprint }),
      { expirationTtl: 90 * 24 * 60 * 60 }
    );
    return json({
      valid: true,
      tenant_id: kv.tenantId,
      company_name: "Unknown",
      tier: "starter",
      status: "active",
      expiry_date: kv.expiresAt,
      enabled_modules: kv.modules,
      enabled_menu_items: DEFAULT_MENU_ITEMS,
      features: DEFAULT_FEATURES,
      rules: [],
      field_mappings: [],
      llm_config: { tier: 1, model: "", notes: "Legacy licence" },
    });
  }

  if (row.status === "suspended") {
    return json({ valid: false, reason: "suspended" }, 403);
  }

  const expiry = new Date(row.expiry_date);
  const expired = expiry < new Date();
  const gracePeriodEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1000);
  const inGrace = expired && new Date() < gracePeriodEnd;

  if (expired && !inGrace) {
    return json({ valid: false, reason: "expired" }, 403);
  }
  if (expired && inGrace) {
    return json(
      { valid: false, reason: "expired_grace", grace_period_ends: gracePeriodEnd.toISOString(), tenant_id: row.id },
      402
    );
  }

  await env.DB.prepare(
    "UPDATE tenants SET last_ping = ?, machine_fingerprint = ?, updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), machineFingerprint || null, nowIso(), row.id)
    .run();

  const enabledModules = JSON.parse(row.enabled_modules || "[]") as string[];
  let rules: ReturnType<typeof parseRule>[] = [];
  if (enabledModules.length > 0) {
    const placeholders = enabledModules.map(() => "?").join(",");
    const rulesResult = await env.DB.prepare(
      `SELECT * FROM rules WHERE enabled = 1 AND module IN (${placeholders}) ORDER BY module, id`
    )
      .bind(...enabledModules)
      .all<RuleRow>();
    rules = (rulesResult.results || []).map(parseRule);
  }

  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field"
  )
    .bind(row.id)
    .all<FieldMappingRow>();

  return json({
    valid: true,
    tenant_id: row.id,
    company_name: row.company_name,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    days_remaining: daysRemaining(row.expiry_date),
    enabled_modules: enabledModules,
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    rules,
    field_mappings: (mappingsResult.results || []).map(parseFieldMapping),
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
  });
}

function handleHeartbeat(): Response {
  return json({ status: "ok", ts: nowIso() });
}

async function handleFieldMappingSync(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    licence_key: string;
    mappings: Array<{
      module: string;
      standard_field: string;
      customer_field: string;
      customer_label?: string;
      is_mapped?: boolean;
      notes?: string;
    }>;
  };

  const { licence_key, mappings } = body;
  if (!licence_key || !Array.isArray(mappings)) {
    return json({ error: "bad_request", message: "licence_key and mappings are required" }, 400);
  }

  const keyHash = await hashKey(licence_key);
  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string }>();
  if (!tenant) return json({ error: "unauthorized", message: "Invalid licence key" }, 401);

  const features = await env.DB.prepare("SELECT features FROM tenants WHERE id = ?")
    .bind(tenant.id)
    .first<{ features: string }>();
  const featureObj = JSON.parse(features?.features || "{}") as TenantFeatures;
  if (!featureObj.field_mapping_self_service) {
    return json({ error: "forbidden", message: "Field mapping self-service is not enabled" }, 403);
  }

  const ts = nowIso();
  let upserted = 0;
  for (const m of mappings) {
    await env.DB.prepare(`
      INSERT INTO field_mappings (id, tenant_id, module, standard_field, customer_field, customer_label, is_mapped, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, module, standard_field) DO UPDATE SET
        customer_field = excluded.customer_field,
        customer_label = excluded.customer_label,
        is_mapped = excluded.is_mapped,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `)
      .bind(
        generateId(), tenant.id, m.module, m.standard_field,
        m.customer_field, m.customer_label || null, m.is_mapped ? 1 : 0,
        m.notes || null, ts
      )
      .run();
    upserted++;
  }

  return json({ synced: upserted, tenant_id: tenant.id });
}

// ─── Admin: Analytics ────────────────────────────────────────────────────────

async function handleAdminAnalytics(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const allTenantsResult = await env.DB.prepare(
    "SELECT status, tier, expiry_date FROM tenants"
  ).all<{ status: string; tier: string; expiry_date: string }>();
  const rows = allTenantsResult.results || [];
  const total = rows.length;

  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const byTier = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {});

  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const expiringResult = await env.DB.prepare(
    "SELECT id, company_name, expiry_date, tier, status FROM tenants WHERE status = 'active' AND expiry_date <= ? ORDER BY expiry_date ASC LIMIT 10"
  )
    .bind(thirtyDaysLater)
    .all<{ id: string; company_name: string; expiry_date: string; tier: string; status: string }>();

  const recentPingsResult = await env.DB.prepare(
    "SELECT id, company_name, last_ping, status FROM tenants WHERE last_ping IS NOT NULL ORDER BY last_ping DESC LIMIT 10"
  ).all<{ id: string; company_name: string; last_ping: string; status: string }>();

  return json({
    total,
    by_status: byStatus,
    by_tier: byTier,
    expiring_soon: expiringResult.results || [],
    recent_activity: recentPingsResult.results || [],
  });
}

// ─── Admin: Tenants ───────────────────────────────────────────────────────────

async function handleListTenants(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const search = url.searchParams.get("q");

  let query = "SELECT * FROM tenants";
  const params: string[] = [];
  const conditions: string[] = [];

  if (status) { conditions.push("status = ?"); params.push(status); }
  if (tier) { conditions.push("tier = ?"); params.push(tier); }
  if (search) {
    conditions.push("(LOWER(company_name) LIKE ? OR LOWER(contact_email) LIKE ?)");
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC";

  const result = await env.DB.prepare(query).bind(...params).all<TenantRow>();
  return json({ tenants: (result.results || []).map(parseTenant) });
}

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    company_name: string;
    contact_email: string;
    tier?: string;
    expiry_date: string;
    enabled_modules?: string[];
    enabled_menu_items?: string[];
    features?: Partial<TenantFeatures>;
    llm_config?: Partial<LlmConfig>;
    status?: string;
    admin_user?: {
      email: string;
      password: string;
      role?: string;
    };
  };

  if (!body.company_name || !body.contact_email || !body.expiry_date) {
    return json({ error: "bad_request", message: "company_name, contact_email, and expiry_date are required" }, 400);
  }

  const tier = body.tier || "starter";
  const licenceKey = generateLicenceKey();
  const keyHash = await hashKey(licenceKey);
  const keySuffix = licenceKey.slice(-4);
  const id = generateId();
  const ts = nowIso();

  const enabledModules = body.enabled_modules || TIER_MODULES[tier] || TIER_MODULES.starter;
  const enabledMenuItems = body.enabled_menu_items || DEFAULT_MENU_ITEMS;
  const features: TenantFeatures = { ...DEFAULT_FEATURES, ...(body.features || {}) };
  const llmConfig: LlmConfig = { tier: 1, model: "", notes: "", ...(body.llm_config || {}) };

  await env.DB.prepare(`
    INSERT INTO tenants (id, company_name, contact_email, licence_key_hash, licence_key_suffix, tier, status, expiry_date, enabled_modules, enabled_menu_items, features, llm_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id, body.company_name, body.contact_email, keyHash, keySuffix,
      tier, body.status || "trial", body.expiry_date,
      JSON.stringify(enabledModules), JSON.stringify(enabledMenuItems),
      JSON.stringify(features), JSON.stringify(llmConfig), ts, ts
    )
    .run();

  // Create admin user if provided
  if (body.admin_user?.email && body.admin_user?.password) {
    const userId = generateId();
    const passwordHash = await hashKey(body.admin_user.password);
    await env.DB.prepare(`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        userId, id, body.admin_user.email, passwordHash,
        body.admin_user.role || "admin", ts, ts
      )
      .run();
  }

  return json({ id, licence_key: licenceKey, company_name: body.company_name, tier, status: body.status || "trial" }, 201);
}

async function handleGetTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseTenant(row));
}

async function handleUpdateTenant(
  tenantId: string,
  request: Request,
  env: Env,
  partial = false
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as Partial<{
    company_name: string;
    contact_email: string;
    tier: string;
    status: string;
    expiry_date: string;
    enabled_modules: string[];
    enabled_menu_items: string[];
    features: Partial<TenantFeatures>;
    llm_config: Partial<LlmConfig>;
  }>;

  const existing = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!existing) return json({ error: "not_found" }, 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.company_name !== undefined) { fields.push("company_name = ?"); values.push(body.company_name); }
  if (body.contact_email !== undefined) { fields.push("contact_email = ?"); values.push(body.contact_email); }
  if (body.tier !== undefined) { fields.push("tier = ?"); values.push(body.tier); }
  if (body.status !== undefined) { fields.push("status = ?"); values.push(body.status); }
  if (body.expiry_date !== undefined) { fields.push("expiry_date = ?"); values.push(body.expiry_date); }
  if (body.enabled_modules !== undefined) { fields.push("enabled_modules = ?"); values.push(JSON.stringify(body.enabled_modules)); }
  if (body.enabled_menu_items !== undefined) { fields.push("enabled_menu_items = ?"); values.push(JSON.stringify(body.enabled_menu_items)); }
  if (body.features !== undefined) {
    const merged = partial ? { ...JSON.parse(existing.features || "{}"), ...body.features } : body.features;
    fields.push("features = ?"); values.push(JSON.stringify(merged));
  }
  if (body.llm_config !== undefined) {
    const merged = partial ? { ...JSON.parse(existing.llm_config || "{}"), ...body.llm_config } : body.llm_config;
    fields.push("llm_config = ?"); values.push(JSON.stringify(merged));
  }

  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);

  fields.push("updated_at = ?"); values.push(nowIso()); values.push(tenantId);

  await env.DB.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  return json(parseTenant(updated!));
}

async function handleDeleteTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM field_mappings WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
  return json({ deleted: true, id: tenantId });
}

async function handleRegenerateKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  const newKey = generateLicenceKey();
  const newHash = await hashKey(newKey);
  const newSuffix = newKey.slice(-4);

  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = ?, licence_key_suffix = ?, updated_at = ? WHERE id = ?"
  )
    .bind(newHash, newSuffix, nowIso(), tenantId)
    .run();

  return json({ licence_key: newKey, tenant_id: tenantId });
}

async function handleGetTenantFieldMappings(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const module = url.searchParams.get("module");
  const query = module
    ? "SELECT * FROM field_mappings WHERE tenant_id = ? AND module = ? ORDER BY standard_field"
    : "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field";
  const params = module ? [tenantId, module] : [tenantId];

  const result = await env.DB.prepare(query).bind(...params).all<FieldMappingRow>();
  return json({ field_mappings: (result.results || []).map(parseFieldMapping) });
}

async function handleUpsertTenantFieldMappings(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    mappings: Array<{
      module: string;
      standard_field: string;
      standard_label?: string;
      customer_field?: string;
      customer_label?: string;
      data_type?: string;
      is_mapped?: boolean;
      notes?: string;
    }>;
  };

  const ts = nowIso();
  let upserted = 0;
  for (const m of body.mappings || []) {
    await env.DB.prepare(`
      INSERT INTO field_mappings (id, tenant_id, module, standard_field, standard_label, customer_field, customer_label, data_type, is_mapped, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, module, standard_field) DO UPDATE SET
        standard_label = excluded.standard_label,
        customer_field = excluded.customer_field,
        customer_label = excluded.customer_label,
        data_type = excluded.data_type,
        is_mapped = excluded.is_mapped,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `)
      .bind(
        generateId(), tenantId, m.module, m.standard_field, m.standard_label || null,
        m.customer_field || null, m.customer_label || null, m.data_type || "string",
        m.is_mapped ? 1 : 0, m.notes || null, ts
      )
      .run();
    upserted++;
  }
  return json({ upserted });
}

// ─── Admin: Rules ─────────────────────────────────────────────────────────────

async function handleListRules(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const module = url.searchParams.get("module");
  const severity = url.searchParams.get("severity");
  const enabled = url.searchParams.get("enabled");
  const search = url.searchParams.get("q");

  let query = "SELECT * FROM rules";
  const params: (string | number)[] = [];
  const conditions: string[] = [];

  if (category) { conditions.push("category = ?"); params.push(category); }
  if (module) { conditions.push("module = ?"); params.push(module); }
  if (severity) { conditions.push("severity = ?"); params.push(severity); }
  if (enabled !== null && enabled !== "") { conditions.push("enabled = ?"); params.push(enabled === "true" ? 1 : 0); }
  if (search) { conditions.push("LOWER(name) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }

  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY category, module, id";

  const result = await env.DB.prepare(query).bind(...params).all<RuleRow>();
  return json({ rules: (result.results || []).map(parseRule), total: result.results?.length || 0 });
}

async function handleCreateRule(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    name: string;
    description?: string;
    module: string;
    category: string;
    severity?: string;
    enabled?: boolean;
    conditions?: unknown[];
    thresholds?: Record<string, unknown>;
    tags?: string[];
  };

  if (!body.name || !body.module || !body.category) {
    return json({ error: "bad_request", message: "name, module, and category are required" }, 400);
  }

  const id = generateId();
  const ts = nowIso();
  await env.DB.prepare(`
    INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id, body.name, body.description || null, body.module, body.category,
      body.severity || "medium", body.enabled !== false ? 1 : 0,
      JSON.stringify(body.conditions || []), JSON.stringify(body.thresholds || {}),
      JSON.stringify(body.tags || []), ts, ts
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RuleRow>();
  return json(parseRule(row!), 201);
}

async function handleGetRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<RuleRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseRule(row));
}

async function handleUpdateRule(
  ruleId: string,
  request: Request,
  env: Env,
  partial = false
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    module: string;
    category: string;
    severity: string;
    enabled: boolean;
    conditions: unknown[];
    thresholds: Record<string, unknown>;
    tags: string[];
  }>;

  const existing = await env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<RuleRow>();
  if (!existing) return json({ error: "not_found" }, 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) { fields.push("name = ?"); values.push(body.name); }
  if (body.description !== undefined) { fields.push("description = ?"); values.push(body.description); }
  if (body.module !== undefined) { fields.push("module = ?"); values.push(body.module); }
  if (body.category !== undefined) { fields.push("category = ?"); values.push(body.category); }
  if (body.severity !== undefined) { fields.push("severity = ?"); values.push(body.severity); }
  if (body.enabled !== undefined) { fields.push("enabled = ?"); values.push(body.enabled ? 1 : 0); }
  if (body.conditions !== undefined) { fields.push("conditions = ?"); values.push(JSON.stringify(body.conditions)); }
  if (body.thresholds !== undefined) { fields.push("thresholds = ?"); values.push(JSON.stringify(body.thresholds)); }
  if (body.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(body.tags)); }

  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?"); values.push(nowIso()); values.push(ruleId);

  await env.DB.prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<RuleRow>();
  return json(parseRule(updated!));
}

async function handleDeleteRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
  return json({ deleted: true, id: ruleId });
}

async function handleBulkImportRules(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    rules: Array<{
      id?: string;
      name: string;
      description?: string;
      module: string;
      category: string;
      severity?: string;
      enabled?: boolean;
      conditions?: unknown[];
      thresholds?: Record<string, unknown>;
      tags?: string[];
    }>;
  };

  const ts = nowIso();
  let imported = 0;
  for (const r of body.rules || []) {
    const id = r.id || generateId();
    await env.DB.prepare(`
      INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        module = excluded.module, category = excluded.category,
        severity = excluded.severity, enabled = excluded.enabled,
        conditions = excluded.conditions, thresholds = excluded.thresholds,
        tags = excluded.tags, updated_at = excluded.updated_at
    `)
      .bind(
        id, r.name, r.description || null, r.module, r.category,
        r.severity || "medium", r.enabled !== false ? 1 : 0,
        JSON.stringify(r.conditions || []), JSON.stringify(r.thresholds || {}),
        JSON.stringify(r.tags || []), ts, ts
      )
      .run();
    imported++;
  }

  return json({ imported });
}

// ─── Tenant User Auth ─────────────────────────────────────────────────────────

async function handleTenantUserLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }

  const passwordHash = await hashKey(body.password);
  const user = await env.DB.prepare(
    "SELECT id, tenant_id, email, role FROM tenant_users WHERE email = ? AND password_hash = ?"
  )
    .bind(body.email, passwordHash)
    .first<{ id: string; tenant_id: string; email: string; role: string }>();

  if (!user) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  // Get tenant info
  const tenant = await env.DB.prepare("SELECT company_name, status FROM tenants WHERE id = ?")
    .bind(user.tenant_id)
    .first<{ company_name: string; status: string }>();

  if (!tenant) {
    return json({ error: "unauthorized", message: "Tenant not found" }, 401);
  }

  if (tenant.status === "suspended") {
    return json({ error: "forbidden", message: "Tenant account is suspended" }, 403);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60, // 8 hours
    },
    env.JWT_SECRET
  );

  return json({
    token,
    expiresIn: 8 * 60 * 60,
    tenant_id: user.tenant_id,
    company_name: tenant.company_name,
  });
}

// ─── Licence Key Management ───────────────────────────────────────────────────

async function handleGetLicenceKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT licence_key_hash FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ licence_key_hash: string | null }>();

  if (!row) return json({ error: "not_found" }, 404);
  if (!row.licence_key_hash) {
    return json({ error: "no_key", message: "This tenant has no active licence key" }, 404);
  }

  // For security, we can't retrieve the original key (it's hashed)
  // Return a message that key exists but can't be shown
  return json({
    message: "Licence key exists but cannot be retrieved (hashed)",
    has_key: true,
    tenant_id: tenantId
  });
}

async function handleDeleteLicenceKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();

  if (!row) return json({ error: "not_found" }, 404);

  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = NULL, licence_key_suffix = NULL, updated_at = ? WHERE id = ?"
  )
    .bind(ts, tenantId)
    .run();

  return json({ deleted: true, tenant_id: tenantId });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── Public: auth ──────────────────────────────────────────────────────
      if (method === "POST" && path === "/api/admin/login") {
        return await handleLogin(request, env);
      }
      if (method === "POST" && path === "/api/tenant/login") {
        return await handleTenantUserLogin(request, env);
      }

      // ── Public: licence ───────────────────────────────────────────────────
      if (method === "POST" && path === "/api/licence/validate") {
        return await handleValidate(request, env);
      }
      if (method === "GET" && path === "/api/licence/heartbeat") {
        return handleHeartbeat();
      }
      if (method === "POST" && path === "/api/licence/field-mappings/sync") {
        return await handleFieldMappingSync(request, env);
      }

      // ── Admin: analytics ──────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/analytics") {
        return await handleAdminAnalytics(request, env);
      }

      // ── Admin: tenants ────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/tenants") {
        return await handleListTenants(request, env);
      }
      if (method === "POST" && path === "/api/admin/tenants") {
        return await handleCreateTenant(request, env);
      }

      const tenantMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)(\/.*)?$/);
      if (tenantMatch) {
        const tenantId = tenantMatch[1];
        const sub = tenantMatch[2] || "";

        if (sub === "/regenerate-key" && method === "POST") return await handleRegenerateKey(tenantId, request, env);
        if (sub === "/offline-token" && method === "POST") return await handleGenerateOfflineToken(tenantId, request, env);
        if (sub === "/licence-key") {
          if (method === "GET") return await handleGetLicenceKey(tenantId, request, env);
          if (method === "DELETE") return await handleDeleteLicenceKey(tenantId, request, env);
        }
        if (sub === "/field-mappings") {
          if (method === "GET") return await handleGetTenantFieldMappings(tenantId, request, env);
          if (method === "PUT" || method === "POST") return await handleUpsertTenantFieldMappings(tenantId, request, env);
        }
        if (sub === "") {
          if (method === "GET") return await handleGetTenant(tenantId, request, env);
          if (method === "PUT") return await handleUpdateTenant(tenantId, request, env, false);
          if (method === "PATCH") return await handleUpdateTenant(tenantId, request, env, true);
          if (method === "DELETE") return await handleDeleteTenant(tenantId, request, env);
        }
      }

      // ── Admin: rules ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/rules") return await handleListRules(request, env);
      if (method === "POST" && path === "/api/admin/rules") return await handleCreateRule(request, env);
      if (method === "POST" && path === "/api/admin/rules/import") return await handleBulkImportRules(request, env);

      const ruleMatch = path.match(/^\/api\/admin\/rules\/([^/]+)$/);
      if (ruleMatch) {
        const ruleId = ruleMatch[1];
        if (method === "GET") return await handleGetRule(ruleId, request, env);
        if (method === "PUT") return await handleUpdateRule(ruleId, request, env, false);
        if (method === "PATCH") return await handleUpdateRule(ruleId, request, env, true);
        if (method === "DELETE") return await handleDeleteRule(ruleId, request, env);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return json({ error: "internal_error", message }, 500);
    }
  },
};
