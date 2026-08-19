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
 * Admin endpoints (require Authorization: Bearer <jwt>, OR the
 * X-Admin-Secret header matching LICENCE_ADMIN_SECRET for server-to-server
 * calls from the HQ portal):
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
 *   GET    /api/admin/release
 *   PUT    /api/admin/release
 */

// Task 09: PBKDF2 password hashing
import { hashPassword, verifyPassword } from "../password-hash";
// MFA (TOTP + single-use recovery code)
import {
  buildOtpauthUri,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "../totp";

interface Env {
  LICENCE_KV: KVNamespace;
  DB: D1Database;
  /** Admin login email — set via wrangler secret put ADMIN_EMAIL */
  ADMIN_EMAIL: string;
  /** SHA-256 hex of the admin password — set via wrangler secret put ADMIN_PASSWORD_HASH */
  ADMIN_PASSWORD_HASH: string;
  /** HMAC-SHA-256 signing secret for admin JWTs — set via wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** Shared secret for server-to-server admin calls from the HQ portal
   * (itself behind Cloudflare Access OTP), sent as the X-Admin-Secret
   * header. Set via wrangler secret put LICENCE_ADMIN_SECRET; must match
   * the portal's LICENCE_ADMIN_SECRET. */
  LICENCE_ADMIN_SECRET?: string;
  /** RSA-PKCS8 private key PEM for offline JWT signing (set as Worker secret) */
  OFFLINE_JWT_PRIVATE_KEY?: string;
  /** Comma-separated list of allowed CORS origins. Falls back to `*`
   * only when explicitly set to `ALLOW_ALL` — otherwise echoes the
   * request Origin only when it appears in the list. */
  CORS_ALLOWED_ORIGINS?: string;
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

// ─── Task 10: Rate Limiting ───────────────────────────────────────────────────

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

const RATE_LIMIT_CONFIG: Record<string, RateLimitConfig> = {
  "/api/admin/login": { maxRequests: 5, windowSeconds: 5 * 60 }, // 5 req/5min
  "/api/licence/validate": { maxRequests: 100, windowSeconds: 60 * 60 }, // 100 req/1hr
  "/api/licence/field-mappings/sync": { maxRequests: 60, windowSeconds: 60 }, // 60 req/min
};

/**
 * Check rate limit for a given IP and endpoint.
 * Uses KVNamespace for distributed rate limiting across Cloudflare edges.
 */
async function checkRateLimit(ip: string, endpoint: string, kv: KVNamespace): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const config = RATE_LIMIT_CONFIG[endpoint];
  if (!config) {
    // No rate limit configured for this endpoint
    return { allowed: true, remaining: -1, resetAt: 0 };
  }

  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
  const kvKey = `ratelimit:${endpoint}:${ip}`;

  try {
    const stored = await kv.get(kvKey);
    let data: { count: number; windowStart: number } = { count: 0, windowStart: now };

    if (stored) {
      data = JSON.parse(stored);
      // If we're outside the window, reset
      if (data.windowStart < windowStart) {
        data = { count: 0, windowStart: now };
      }
    }

    const remaining = config.maxRequests - data.count;
    const allowed = data.count < config.maxRequests;

    // Increment counter and update KV
    data.count += 1;
    const expirationTtl = config.windowSeconds + 60; // Add 60s buffer
    await kv.put(kvKey, JSON.stringify(data), {
      expirationTtl,
      metadata: { endpoint, ip, timestamp: now.toString() },
    });

    const resetAt = data.windowStart + config.windowSeconds * 1000;
    return { allowed, remaining: Math.max(0, remaining), resetAt };
  } catch (err) {
    console.error(`Rate limit check failed for ${ip}:${endpoint}`, err);
    // On error, allow the request (fail-open)
    return { allowed: true, remaining: -1, resetAt: 0 };
  }
}

// ─── Structured logging ───────────────────────────────────────────────────────
// Cloudflare Logpush / `wrangler tail` both parse JSON natively. Every log
// line emits one JSON object so operators can filter by `level`, `event`,
// `admin_id` etc. without regex gymnastics.

function logJson(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: nowIso(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ─── LIKE escaping ────────────────────────────────────────────────────────────
// `%` and `_` are SQL wildcards in LIKE. Escape them so user-supplied search
// input doesn't match more than the user meant.
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Two modes:
//   - `ALLOW_ALL`  →  pre-2026 behaviour, echo `*`. Only for dev.
//   - comma-list   →  echo the request Origin ONLY if it appears in the list.
// If CORS_ALLOWED_ORIGINS is unset we fall back to `*` WITHOUT
// allow-credentials — a browser won't send cookies to such a response,
// so at worst unauthenticated callers can poke the public endpoints.

function parseAllowedOrigins(env: Env): { allowAll: boolean; list: string[] } {
  const raw = (env.CORS_ALLOWED_ORIGINS || "").trim();
  if (raw === "ALLOW_ALL") return { allowAll: true, list: [] };
  if (!raw) return { allowAll: false, list: [] };
  return { allowAll: false, list: raw.split(",").map((s) => s.trim()).filter(Boolean) };
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const { allowAll, list } = parseAllowedOrigins(env);
  const reqOrigin = request.headers.get("Origin") || "";

  const common: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };

  if (allowAll) {
    // Public wildcard — cannot combine with credentials per the spec.
    return { ...common, "Access-Control-Allow-Origin": "*" };
  }
  if (reqOrigin && list.includes(reqOrigin)) {
    return {
      ...common,
      "Access-Control-Allow-Origin": reqOrigin,
      "Access-Control-Allow-Credentials": "true",
    };
  }
  // No match — don't set Access-Control-Allow-Origin at all (browser blocks).
  return common;
}

function cors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

function json<T>(data: T, status = 200, request?: Request, env?: Env): Response {
  const body = new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (request && env) return cors(body, request, env);
  // Legacy path used from places that don't yet thread request/env through —
  // still return a well-formed response; CORS headers layered on by the
  // top-level fetch handler's final cors() pass.
  return body;
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
  secret: string,
  opts: { db?: D1Database } = {}
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

  const nowSec = Math.floor(Date.now() / 1000);

  // iat sanity — reject tokens claiming issuance >60s in the future, which
  // is either a clock skew bomb or a forged header. Generous bound so real
  // client/server drift doesn't lock people out.
  if (typeof payload.iat === "number" && payload.iat > nowSec + 60) {
    return null;
  }
  // nbf — not-before. Only honour if present.
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return null;
  }

  // jti revocation — if the token carries a jti and a DB handle is
  // available, reject when the session has been revoked or expired.
  // Tokens without a jti (offline licence JWTs, legacy admin JWTs pre-
  // migration-003) are accepted as before — the db lookup is opt-in.
  if (opts.db && typeof payload.jti === "string" && payload.jti) {
    try {
      const row = await opts.db
        .prepare(
          "SELECT revoked_at, expires_at FROM admin_sessions WHERE jti = ?"
        )
        .bind(payload.jti)
        .first<{ revoked_at: string | null; expires_at: string }>();
      if (row) {
        if (row.revoked_at) return null;
        if (new Date(row.expires_at).getTime() < Date.now()) return null;
      } else {
        // A session-bearing token must have a matching row. If the row
        // was deleted (e.g. by a full logout-all), reject.
        return null;
      }
    } catch (err) {
      // Fail closed on DB errors during revocation check — see the
      // rationale in handleLogin for why this direction matters.
      logJson("error", "jwt_revocation_check_failed", { err: String(err) });
      return null;
    }
  }

  return payload;
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────

/**
 * Authenticate and role-check an admin-endpoint request.
 *
 * Returns either:
 *   - { ok: true, payload } on success — handlers can inspect the JWT
 *   - { ok: false, response } on failure — handler must return the response
 *
 * `allowedRoles` defaults to ["admin"]. Readonly admins can be admitted by
 * passing ["admin", "readonly"] on the corresponding GET handlers.
 */
type AuthOk = { ok: true; payload: Record<string, unknown> };
type AuthFail = { ok: false; response: Response };

// Constant-time string compare — avoids leaking the admin secret via
// response timing. Length mismatch returns false immediately (length is
// not itself secret).
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function requireAuth(
  request: Request,
  env: Env,
  allowedRoles: string[] = ["admin"]
): Promise<AuthOk | AuthFail> {
  // Server-to-server: the HQ portal (gated by Cloudflare Access OTP at the
  // edge) authenticates to admin endpoints with the shared
  // LICENCE_ADMIN_SECRET rather than a per-user JWT. A constant-time match
  // grants full admin. On mismatch we fall through to the JWT path so a
  // stray header never locks out a valid Bearer caller.
  const adminSecret = request.headers.get("X-Admin-Secret");
  if (
    adminSecret &&
    env.LICENCE_ADMIN_SECRET &&
    allowedRoles.includes("admin") &&
    timingSafeEqualStr(adminSecret, env.LICENCE_ADMIN_SECRET)
  ) {
    return { ok: true, payload: { sub: "hq-portal", role: "admin", via: "admin_secret" } };
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "unauthorized", message: "Missing or invalid Authorization header" }, 401) };
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET, { db: env.DB });
  if (!payload) {
    return { ok: false, response: json({ error: "unauthorized", message: "Invalid or expired token" }, 401) };
  }
  // Defence-in-depth: tenant-user JWTs (issued by /api/tenant/login) and
  // admin-user JWTs share JWT_SECRET, so a tenant user presenting their
  // token to an admin endpoint would otherwise be accepted. Enforce role.
  const role = String(payload.role ?? "");
  if (!allowedRoles.includes(role)) {
    return { ok: false, response: json({ error: "forbidden", message: "Insufficient role" }, 403) };
  }
  return { ok: true, payload };
}

// Legacy adapter — keeps older call sites compiling while the switch to
// requireAuth happens below. New code should use requireAuth directly.
async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const r = await requireAuth(request, env, ["admin"]);
  return r.ok ? null : r.response;
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

// Must stay in sync with ALL_MENU_ITEMS in
// cloudflare/portal/app/admin/tenants/[tenant_id]/TenantDetailClient.tsx and
// the licenceKey values in frontend/app/(dashboard)/layout.tsx's nav config —
// rules_engine and field_mapping were added to both of those but never
// backfilled here, so every tenant created via the normal "New Tenant" flow
// (which omits enabled_menu_items and falls back to this default) was
// silently missing Settings > Rules Engine and Settings > Field Mapping
// until an admin manually opened the tenant and toggled them on.
const DEFAULT_MENU_ITEMS = [
  "dashboard", "findings", "versions", "analytics", "import", "sync",
  "reports", "stewardship", "contracts", "ask_meridian", "export",
  "user_management", "rules_engine", "settings", "field_mapping", "licence",
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

const LOCKOUT_THRESHOLD = 5;        // wrong attempts that trigger a lock
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    mfa_code?: string;
    mfa_recovery_code?: string;
  };

  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }

  try {
    const admin = await env.DB.prepare(
      "SELECT id, email, password_hash, password_salt, role, is_active, failed_attempts, locked_until, " +
      "mfa_secret, mfa_enabled, mfa_recovery_hash " +
      "FROM admins WHERE email = ? LIMIT 1"
    )
      .bind(body.email)
      .first<{
        id: string;
        email: string;
        password_hash: string;
        password_salt: string;
        role: string;
        is_active: number;
        failed_attempts: number | null;
        locked_until: string | null;
        mfa_secret: string | null;
        mfa_enabled: number | null;
        mfa_recovery_hash: string | null;
      }>();

    // Uniform 401 on missing user so we don't leak email existence. No
    // branch on `admin` here — we fall through to verifyPassword against
    // a known-bad hash below if the account doesn't exist. That keeps the
    // timing profile roughly the same whether the email exists or not.
    const genericReject = () =>
      json({ error: "unauthorized", message: "Invalid credentials" }, 401);

    if (!admin || !admin.is_active) {
      // Still spend the time verifying a dummy hash so we don't leak
      // account existence via response time.
      await verifyPassword(
        body.password,
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0000000000000000000000000000000000000000000000000000000000000000"
      ).catch(() => false);
      return genericReject();
    }

    // Lockout check — reject with a hint (so a legitimate locked user
    // knows to wait), but don't reveal whether the email was otherwise
    // valid for non-locked accounts.
    if (admin.locked_until) {
      const until = new Date(admin.locked_until).getTime();
      if (until > Date.now()) {
        return json({
          error: "locked",
          message: "Account temporarily locked due to repeated failed logins. Try again later.",
          retry_after_seconds: Math.ceil((until - Date.now()) / 1000),
        }, 423);
      }
    }

    // Verify password using PBKDF2 with constant-time comparison
    const passwordValid = await verifyPassword(body.password, admin.password_hash, admin.password_salt);
    if (!passwordValid) {
      const attempts = (admin.failed_attempts ?? 0) + 1;
      const lockUntil =
        attempts >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
          : null;
      try {
        await env.DB.prepare(
          "UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?"
        )
          .bind(attempts, lockUntil, admin.id)
          .run();
      } catch (err) {
        logJson("warn", "admin_login_fail_counter_update_error", { err: String(err) });
      }
      if (lockUntil) {
        logJson("warn", "admin_account_locked", { admin_id: admin.id, email: admin.email, attempts });
      }
      return genericReject();
    }

    // MFA gate — password was correct, now require the second factor.
    // Two inputs accepted: a 6-digit TOTP code OR a single-use recovery
    // code. If MFA is enabled and neither is provided (or both are
    // wrong), we increment failed_attempts exactly as we would for a
    // wrong password, so a TOTP brute force hits the lockout wall.
    if (admin.mfa_enabled === 1 && admin.mfa_secret) {
      const mfaCode = (body.mfa_code || "").trim();
      const recovery = (body.mfa_recovery_code || "").trim();
      let mfaOk = false;
      let usedRecovery = false;
      if (recovery && admin.mfa_recovery_hash) {
        const h = await hashRecoveryCode(recovery);
        if (h === admin.mfa_recovery_hash) {
          mfaOk = true;
          usedRecovery = true;
        }
      }
      if (!mfaOk && mfaCode) {
        mfaOk = await verifyTotp(admin.mfa_secret, mfaCode);
      }

      if (!mfaOk) {
        if (!mfaCode && !recovery) {
          // Tell the client the next step — no counter bump for the
          // first request without a code.
          return json({ error: "mfa_required", mfa_required: true }, 401);
        }
        // Wrong / expired code — treat as a failed attempt.
        const attempts = (admin.failed_attempts ?? 0) + 1;
        const lockUntil =
          attempts >= LOCKOUT_THRESHOLD
            ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
            : null;
        try {
          await env.DB.prepare(
            "UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?"
          )
            .bind(attempts, lockUntil, admin.id)
            .run();
        } catch (err) {
          logJson("warn", "admin_mfa_fail_counter_update_error", { err: String(err) });
        }
        if (lockUntil) {
          logJson("warn", "admin_account_locked_mfa", { admin_id: admin.id, attempts });
        }
        return json({ error: "mfa_invalid", message: "Invalid MFA code" }, 401);
      }

      // Recovery code is single-use — invalidate after successful use
      // and disable MFA so the admin can re-enrol a fresh authenticator.
      if (usedRecovery) {
        try {
          await env.DB.prepare(
            "UPDATE admins SET mfa_recovery_hash = NULL, mfa_enabled = 0, mfa_secret = NULL WHERE id = ?"
          )
            .bind(admin.id)
            .run();
        } catch (err) {
          logJson("warn", "admin_mfa_recovery_cleanup_error", { err: String(err) });
        }
        logJson("warn", "admin_mfa_recovery_used", { admin_id: admin.id, email: admin.email });
      }
    }

    // Success — reset the counter + clear any lock, stamp last_login_at.
    try {
      await env.DB.prepare(
        "UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
        .bind(admin.id)
        .run();
    } catch {
      // Best effort — don't fail the login.
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const jti = generateId();
    const expSec = nowSec + 8 * 60 * 60; // 8 hours
    const token = await signJwt(
      {
        sub: admin.email,
        role: admin.role,
        jti,
        iat: nowSec,
        exp: expSec,
      },
      env.JWT_SECRET
    );

    // Record the session so POST /api/admin/logout (and future "logout
    // everywhere" flows) can revoke it server-side.
    try {
      await env.DB.prepare(
        "INSERT INTO admin_sessions (jti, admin_id, issued_at, expires_at, last_seen_at, ip, user_agent) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          jti,
          admin.id,
          nowIso(),
          new Date(expSec * 1000).toISOString(),
          nowIso(),
          request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || null,
          request.headers.get("user-agent") || null,
        )
        .run();
    } catch (err) {
      logJson("warn", "admin_session_insert_error", { err: String(err) });
      // If we fail to record the session, downstream revocation check
      // will reject the token (no matching row). Fail closed rather
      // than returning a token that can't be revoked.
      return json({ error: "service_unavailable", message: "Authentication temporarily unavailable" }, 503);
    }

    logJson("info", "admin_login_success", { admin_id: admin.id, email: admin.email, jti });
    return json({ token, expiresIn: 8 * 60 * 60 });
  } catch (err) {
    // Fail closed on DB errors. The previous implementation fell back to
    // an env-variable SHA-256 hash — which downgraded admin auth any
    // time the database was slow. Log loudly, reject the request.
    logJson("error", "admin_login_db_error", { err: String(err) });
    return json({ error: "service_unavailable", message: "Authentication temporarily unavailable" }, 503);
  }
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

// ─── Response signing (anti-self-grant) ───────────────────────────────────────
// A customer who holds the image can MITM their own licence check; an HMAC with
// a shared secret in the image would not stop them (they hold the secret). Only
// an asymmetric signature — private key here in Cloudflare, public key in the
// client env — prevents a self-granted `valid:true`. We reuse the existing
// OFFLINE_JWT_PRIVATE_KEY (RSASSA-PKCS1-v1_5 / SHA-256). Clients verify ONLY when
// LICENCE_SERVER_PUBLIC_KEY is configured, so the worker deploys first and the
// operator flips enforcement on afterwards — no forced lockout.

// Canonical entitlement string — MUST be byte-identical to the Python client's
// `_entitlement_canonical` in api/middleware/licence.py. Fixed field list and a
// "\n" join (not JSON) so the two languages cannot diverge on key order or
// whitespace/escaping. Covers the entitlement fields that gate access; rules and
// field_mappings are data sync, not entitlement, so tampering them grants nothing.
function entitlementCanonical(f: {
  tenant_id: string;
  expiry_date: string;
  enabled_modules: string[];
  enabled_menu_items: string[];
  features: Record<string, unknown>;
  machine_fingerprint: string;
  signed_at: number;
}): string {
  const featKeys = Object.keys(f.features)
    .filter((k) => !!f.features[k])
    .sort();
  return [
    "meridian-licence-v1",
    "1", // valid
    f.tenant_id,
    f.expiry_date,
    [...f.enabled_modules].sort().join(","),
    [...f.enabled_menu_items].sort().join(","),
    featKeys.join(","),
    f.machine_fingerprint || "",
    String(f.signed_at),
  ].join("\n");
}

// Returns standard (padded) base64 signature, or null when no signing key is set
// (older deployments / not-yet-configured — client treats unsigned as legacy).
async function signEntitlement(env: Env, canonical: string): Promise<string | null> {
  if (!env.OFFLINE_JWT_PRIVATE_KEY) return null;
  const pemBody = env.OFFLINE_JWT_PRIVATE_KEY.trim()
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
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(canonical)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

// Soft node-lock: the client fingerprint is sha256(hostname + MAC), which CHANGES
// on every Docker container restart/reschedule, so a hard lock would lock out
// legitimate customers. Instead we record each distinct fingerprint per tenant
// and surface concurrent ones to admin as a licence-sharing SIGNAL — never reject.
// Best-effort: a failure here (e.g. table missing pre-migration) must never break
// validation, so the caller wraps this in try/catch.
async function trackNode(env: Env, tenantId: string, fingerprint: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO licence_nodes (tenant_id, fingerprint, first_seen, last_seen, ping_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(tenant_id, fingerprint)
     DO UPDATE SET last_seen = excluded.last_seen, ping_count = ping_count + 1`
  )
    .bind(tenantId, fingerprint, nowIso(), nowIso())
    .run();
}

// ─── Licence Validation ───────────────────────────────────────────────────────

async function handleValidate(request: Request, env: Env): Promise<Response> {
  // Accept either `licenceKey` (camelCase, historical) or `licence_key`
  // (snake_case, matches the field-mappings/sync endpoint). One unified
  // shape going forward.
  const body = (await request.json()) as {
    licenceKey?: string;
    licence_key?: string;
    machineFingerprint?: string;
    machine_fingerprint?: string;
  };
  const licenceKey = body.licenceKey || body.licence_key;
  const machineFingerprint = body.machineFingerprint || body.machine_fingerprint;

  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }

  const keyHash = await hashKey(licenceKey);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<TenantRow>();

  if (!row) {
    // D1 is the source of truth. The KV fallback granted `valid: true`
    // to any entry with `active: true` in KV, which made D1-side
    // revocation (suspend, delete) ineffective for any key that lived
    // in the pre-migration KV store. Removed deliberately — cleaner
    // state model.
    return json({ valid: false, reason: "invalid_key" }, 403);
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

  // Soft node-lock — record the fingerprint for admin sharing-detection. Never
  // fatal: a failure here must not break a valid licence check.
  if (machineFingerprint) {
    try {
      await trackNode(env, row.id, machineFingerprint);
    } catch (e) {
      console.warn("node tracking failed (non-fatal):", e);
    }
  }

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

  const enabledMenuItems = JSON.parse(row.enabled_menu_items || "[]") as string[];
  const features = JSON.parse(row.features || "{}") as TenantFeatures;

  // Sign the entitlement so a customer cannot forge `valid:true` by MITMing
  // their own licence check. signed_at is covered by the signature (freshness)
  // and machine_fingerprint binds the grant to the requesting node.
  const signedAt = Math.floor(Date.now() / 1000);
  const fingerprint = machineFingerprint || "";
  const signature = await signEntitlement(
    env,
    entitlementCanonical({
      tenant_id: row.id,
      expiry_date: row.expiry_date,
      enabled_modules: enabledModules,
      enabled_menu_items: enabledMenuItems,
      features: features as Record<string, unknown>,
      machine_fingerprint: fingerprint,
      signed_at: signedAt,
    })
  );

  // Advisory platform-update signal — NOT part of the signed entitlement
  // (see entitlementCanonical above). A missing table (e.g. this migration
  // hasn't run yet in some environment) or any other D1 hiccup must never
  // fail an otherwise-valid licence check, so this is best-effort only.
  let latestVersion = "";
  let releaseNotes = "";
  try {
    const releaseRow = await env.DB.prepare(
      "SELECT latest_version, release_notes FROM platform_releases WHERE id = 1"
    ).first<{ latest_version: string; release_notes: string }>();
    if (releaseRow) {
      latestVersion = releaseRow.latest_version || "";
      releaseNotes = releaseRow.release_notes || "";
    }
  } catch (e) {
    console.warn("platform release lookup failed (non-fatal):", e);
  }

  return json({
    valid: true,
    tenant_id: row.id,
    company_name: row.company_name,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    days_remaining: daysRemaining(row.expiry_date),
    enabled_modules: enabledModules,
    enabled_menu_items: enabledMenuItems,
    features,
    rules,
    field_mappings: (mappingsResult.results || []).map(parseFieldMapping),
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
    // Anti-self-grant signature (verified by clients that set LICENCE_SERVER_PUBLIC_KEY).
    signature,
    signed_at: signedAt,
    machine_fingerprint: fingerprint,
    signature_alg: "RS256-canonical-v1",
    // Advisory only — outside the signed canonical, see comment above.
    latest_version: latestVersion,
    release_notes: releaseNotes,
  });
}

async function handleHeartbeat(env: Env): Promise<Response> {
  // Verify the DB is actually reachable. A worker can be "up" while D1 is
  // unhappy; a monitoring probe that only checks the worker misses that.
  // A single cheap SELECT 1 is ~1-2ms overhead and catches every real
  // connectivity issue.
  let dbOk = true;
  let dbError: string | undefined;
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message : "unknown";
  }
  return json(
    { status: dbOk ? "ok" : "degraded", ts: nowIso(), db: dbOk ? "ok" : "error", ...(dbError ? { db_error: dbError } : {}) },
    dbOk ? 200 : 503,
  );
}

async function handleFieldMappingSync(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    licenceKey?: string;
    licence_key?: string;
    mappings: Array<{
      module: string;
      standard_field: string;
      customer_field: string;
      customer_label?: string;
      is_mapped?: boolean;
      notes?: string;
    }>;
  };

  const licenceKey = body.licenceKey || body.licence_key;
  const { mappings } = body;
  if (!licenceKey || !Array.isArray(mappings)) {
    return json({ error: "bad_request", message: "licenceKey and mappings are required" }, 400);
  }

  const keyHash = await hashKey(licenceKey);
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

  // Soft node-lock signal: tenants seen on >1 distinct fingerprint in the last
  // 24h — a possible shared/duplicated licence. Informational only, never blocks.
  // Wrapped so a pre-migration missing table can't 500 the analytics page.
  let concurrentNodes: Array<{ id: string; company_name: string; node_count: number }> = [];
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sharingResult = await env.DB.prepare(
      `SELECT n.tenant_id AS id, t.company_name AS company_name, COUNT(*) AS node_count
       FROM licence_nodes n JOIN tenants t ON t.id = n.tenant_id
       WHERE n.last_seen >= ?
       GROUP BY n.tenant_id HAVING COUNT(*) > 1
       ORDER BY node_count DESC LIMIT 10`
    )
      .bind(since)
      .all<{ id: string; company_name: string; node_count: number }>();
    concurrentNodes = sharingResult.results || [];
  } catch (e) {
    console.warn("concurrent-node query failed (non-fatal):", e);
  }

  return json({
    total,
    by_status: byStatus,
    by_tier: byTier,
    expiring_soon: expiringResult.results || [],
    recent_activity: recentPingsResult.results || [],
    concurrent_nodes: concurrentNodes,
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
    // `%` and `_` are SQL wildcards — escape so user input matches literally.
    const pattern = `%${escapeLike(search.toLowerCase())}%`;
    conditions.push("(LOWER(company_name) LIKE ? ESCAPE '\\' OR LOWER(contact_email) LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
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

  // Create admin user if provided — stored with PBKDF2 + per-row salt so
  // the password hash can't be compared against a rainbow table. Matches
  // the admins table's scheme (migration 002_tenant_users_pbkdf2.sql).
  if (body.admin_user?.email && body.admin_user?.password) {
    const userId = generateId();
    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(body.admin_user.password);
    await env.DB.prepare(`
      INSERT INTO tenant_users
        (id, tenant_id, email, password_hash, password_salt, password_scheme,
         role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pbkdf2', ?, ?, ?)
    `)
      .bind(
        userId, id, body.admin_user.email, passwordHash, passwordSalt,
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

  // Cascade delete — tenant_users was previously orphaned, leaving stale
  // auth rows that could re-auth if a tenant_id collision ever happened.
  await env.DB.prepare("DELETE FROM tenant_users WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM field_mappings WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
  logJson("info", "tenant_deleted", { tenant_id: tenantId });
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
  if (search) {
    conditions.push("LOWER(name) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(search.toLowerCase())}%`);
  }

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

  // Lookup by email only — never by (email, password_hash). Filtering on
  // the hash in the WHERE clause creates a timing oracle for email
  // enumeration and forces the weaker sha256 scheme.
  const user = await env.DB.prepare(
    "SELECT id, tenant_id, email, role, password_hash, password_salt, password_scheme, is_active " +
    "FROM tenant_users WHERE email = ? LIMIT 1"
  )
    .bind(body.email)
    .first<{
      id: string;
      tenant_id: string;
      email: string;
      role: string;
      password_hash: string;
      password_salt: string | null;
      password_scheme: string | null;
      is_active: number | null;
    }>();

  if (!user || (user.is_active !== null && user.is_active === 0)) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  // Dispatch on the stored scheme. New rows are always pbkdf2; legacy
  // rows (pre-migration-002) are sha256 and get transparently upgraded
  // to pbkdf2 on their next successful login.
  let passwordValid = false;
  const scheme = user.password_scheme || "sha256";
  if (scheme === "pbkdf2") {
    if (!user.password_salt) {
      // Shouldn't happen post-migration, but fail closed if it does.
      return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
    }
    passwordValid = await verifyPassword(body.password, user.password_hash, user.password_salt);
  } else if (scheme === "sha256") {
    const computed = await hashKey(body.password);
    // Constant-time compare — plain === leaks early-mismatch timing.
    passwordValid = computed.length === user.password_hash.length;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ user.password_hash.charCodeAt(i);
    }
    passwordValid = passwordValid && diff === 0;
  }

  if (!passwordValid) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  // Opportunistic upgrade: if the user just logged in with a legacy
  // sha256 hash, rehash with PBKDF2 so the next login is stronger. No
  // impact on the current response.
  if (scheme === "sha256") {
    try {
      const { hash: newHash, salt: newSalt } = await hashPassword(body.password);
      await env.DB.prepare(
        "UPDATE tenant_users SET password_hash = ?, password_salt = ?, " +
        "password_scheme = 'pbkdf2', updated_at = ? WHERE id = ?"
      )
        .bind(newHash, newSalt, nowIso(), user.id)
        .run();
    } catch (err) {
      console.warn("tenant_users PBKDF2 upgrade failed for", user.id, err);
    }
  }

  // Best-effort last_login_at
  try {
    await env.DB.prepare("UPDATE tenant_users SET last_login_at = ? WHERE id = ?")
      .bind(nowIso(), user.id)
      .run();
  } catch {
    // ignore
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

// ─── Admin: Platform Release ─────────────────────────────────────────────────
// Singleton row (id = 1) — one global "latest platform version" for the whole
// product, not per-tenant. Published from the HQ portal and surfaced to every
// customer deployment via handleValidate's response so it can prompt an admin
// to trigger a one-click update.

interface PlatformReleaseRow {
  id: number;
  latest_version: string;
  release_notes: string;
  released_at: string | null;
  updated_at: string;
}

// Accepts an optional leading "v" but the stored value is always normalized
// without one, since that's what the customer-side semver comparison expects.
const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;

async function handleGetRelease(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM platform_releases WHERE id = 1")
    .first<PlatformReleaseRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(row);
}

async function handleUpdateRelease(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as Partial<{
    latest_version: string;
    release_notes: string;
  }>;

  const rawVersion = (body.latest_version ?? "").trim();
  const versionMatch = rawVersion.match(VERSION_RE);
  if (!rawVersion || !versionMatch) {
    return json(
      { error: "bad_request", message: "latest_version is required and must look like MAJOR.MINOR.PATCH (optionally prefixed with 'v')" },
      400
    );
  }
  const latestVersion = versionMatch[1];
  const releaseNotes = body.release_notes ?? "";

  await env.DB.prepare(
    "UPDATE platform_releases SET latest_version = ?, release_notes = ?, released_at = datetime('now'), updated_at = datetime('now') WHERE id = 1"
  )
    .bind(latestVersion, releaseNotes)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM platform_releases WHERE id = 1")
    .first<PlatformReleaseRow>();
  return json(updated!);
}

// ─── Router ───────────────────────────────────────────────────────────────────

// ─── Admin audit log ──────────────────────────────────────────────────────────
// Mirror of the customer-side audit_log (migration 038 Postgres-side).
// Called after every successful admin mutation.

const _AUDIT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function deriveEntityAndAction(method: string, path: string): { entity_type: string | null; entity_id: string | null; action: string } {
  // /api/admin/tenants/<id>/<sub?>  or  /api/admin/rules/<id>
  const parts = path.split("/").filter(Boolean);
  // ["api", "admin", "tenants", "<id>", ...]
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "admin") {
    return { entity_type: null, entity_id: null, action: method.toLowerCase() };
  }
  const entity_type = parts[2] ?? null;
  const entity_id = parts.length >= 4 ? (parts[3] ?? null) : null;
  let action: string;
  if (method === "DELETE") action = "delete";
  else if (method === "POST" && parts.length >= 5) action = parts[4]; // e.g. regenerate-key
  else action = method.toLowerCase();
  return { entity_type, entity_id, action };
}

async function writeAdminAudit(
  request: Request,
  env: Env,
  response: Response,
  payload: Record<string, unknown> | null,
): Promise<void> {
  if (!_AUDIT_METHODS.has(request.method)) return;
  if (response.status >= 400) return; // log only successful mutations
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/")) return;
  if (path === "/api/admin/login" || path === "/api/admin/logout") return; // auth flows log themselves

  const { entity_type, entity_id, action } = deriveEntityAndAction(request.method, path);
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    null;
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit " +
      "(id, admin_id, admin_email, action, entity_type, entity_id, method, path, status_code, ip, user_agent, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        generateId(),
        (payload?.admin_id as string) || null,
        (payload?.sub as string) || null,
        action,
        entity_type,
        entity_id,
        request.method,
        path,
        response.status,
        ip,
        request.headers.get("user-agent") || null,
        nowIso(),
      )
      .run();
  } catch (err) {
    // Auditing must never break the request. Log and swallow.
    logJson("warn", "admin_audit_write_failed", { err: String(err), path });
  }
}

// ─── New admin endpoints (added in this PR) ───────────────────────────────────

async function handleAdminMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  // Look up the admin row so we can return is_active + last_login_at
  const adminEmail = String(auth.payload.sub ?? "");
  const row = await env.DB.prepare(
    "SELECT id, email, role, is_active, last_login_at FROM admins WHERE email = ? LIMIT 1"
  )
    .bind(adminEmail)
    .first<{ id: string; email: string; role: string; is_active: number; last_login_at: string | null }>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({
    id: row.id,
    email: row.email,
    role: row.role,
    is_active: row.is_active === 1,
    last_login_at: row.last_login_at,
    session_jti: auth.payload.jti ?? null,
  });
}

async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const jti = auth.payload.jti;
  if (typeof jti === "string" && jti) {
    try {
      await env.DB.prepare(
        "UPDATE admin_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL"
      )
        .bind(nowIso(), jti)
        .run();
      logJson("info", "admin_logout", { email: auth.payload.sub, jti });
    } catch (err) {
      logJson("warn", "admin_logout_db_error", { err: String(err) });
    }
  }
  return json({ ok: true });
}

// ─── MFA enrol / verify / disable ────────────────────────────────────────────

async function handleMfaEnroll(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const email = String(auth.payload.sub ?? "");

  // Issue a pending secret. mfa_enabled stays 0 until verify succeeds —
  // that way a dropped enrol flow doesn't lock the admin out.
  const secret = generateTotpSecret();
  try {
    await env.DB.prepare(
      "UPDATE admins SET mfa_secret = ?, mfa_enabled = 0 WHERE email = ?"
    )
      .bind(secret, email)
      .run();
  } catch (err) {
    logJson("error", "mfa_enroll_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  const otpauthUri = buildOtpauthUri({
    secret,
    accountName: email,
    issuer: "Meridian HQ",
  });
  return json({
    otpauth_uri: otpauthUri,
    secret, // so admins who can't scan can type it in manually
  });
}

async function handleMfaVerify(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const email = String(auth.payload.sub ?? "");

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  if (!body.code) {
    return json({ error: "bad_request", message: "code is required" }, 400);
  }

  const admin = await env.DB.prepare(
    "SELECT id, mfa_secret FROM admins WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; mfa_secret: string | null }>();
  if (!admin || !admin.mfa_secret) {
    return json({ error: "not_enrolled", message: "Call /api/admin/mfa/enroll first" }, 400);
  }

  const ok = await verifyTotp(admin.mfa_secret, body.code);
  if (!ok) return json({ error: "mfa_invalid", message: "Invalid code" }, 401);

  // MFA is good — activate it + mint a recovery code (returned exactly
  // once; we only store the hash so losing it later is unrecoverable
  // unless an ops admin resets via handleMfaDisable).
  const { plaintext: recovery, hash } = await generateRecoveryCode();
  try {
    await env.DB.prepare(
      "UPDATE admins SET mfa_enabled = 1, mfa_enrolled_at = ?, mfa_recovery_hash = ? WHERE id = ?"
    )
      .bind(nowIso(), hash, admin.id)
      .run();
  } catch (err) {
    logJson("error", "mfa_verify_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  logJson("info", "mfa_enrolled", { admin_id: admin.id, email });
  return json({ enabled: true, recovery_code: recovery });
}

async function handleMfaDisable(request: Request, env: Env): Promise<Response> {
  // Only admin role can disable MFA — readonly can enrol themselves but
  // cannot remove the protection.
  const auth = await requireAuth(request, env, ["admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const targetEmail = body.email || String(auth.payload.sub ?? "");

  try {
    const result = await env.DB.prepare(
      "UPDATE admins SET mfa_enabled = 0, mfa_secret = NULL, mfa_recovery_hash = NULL, mfa_enrolled_at = NULL WHERE email = ?"
    )
      .bind(targetEmail)
      .run();
    logJson("warn", "mfa_disabled", {
      actor: auth.payload.sub,
      target_email: targetEmail,
      changes: (result.meta as { changes?: number })?.changes ?? 0,
    });
  } catch (err) {
    logJson("error", "mfa_disable_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  return json({ disabled: true, email: targetEmail });
}

async function handleAdminAuditList(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const entityType = url.searchParams.get("entity_type");
  const entityId = url.searchParams.get("entity_id");

  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (entityType) { conds.push("entity_type = ?"); params.push(entityType); }
  if (entityId) { conds.push("entity_id = ?"); params.push(entityId); }
  const where = conds.length ? " WHERE " + conds.join(" AND ") : "";

  const result = await env.DB.prepare(
    `SELECT id, admin_id, admin_email, action, entity_type, entity_id, method, path, status_code, ip, created_at ` +
    `FROM admin_audit${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all();
  return json({ entries: result.results || [], limit, offset });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const clientIp = request.headers.get("cf-connecting-ip") ||
                     request.headers.get("x-forwarded-for")?.split(",")[0] ||
                     "unknown";

    let response: Response;
    let authPayloadForAudit: Record<string, unknown> | null = null;

    try {
      // ── Public: auth ──────────────────────────────────────────────────────
      if (method === "POST" && path === "/api/admin/login") {
        const limit = await checkRateLimit(clientIp, path, env.LICENCE_KV);
        if (!limit.allowed) {
          response = json({
            error: "rate_limit_exceeded",
            message: "Too many login attempts. Please try again later.",
            resetAt: new Date(limit.resetAt).toISOString()
          }, 429);
        } else {
          response = await handleLogin(request, env);
        }
      } else if (method === "POST" && path === "/api/tenant/login") {
        response = await handleTenantUserLogin(request, env);
      } else if (method === "POST" && path === "/api/admin/logout") {
        response = await handleAdminLogout(request, env);
      } else if (method === "GET" && path === "/api/admin/me") {
        response = await handleAdminMe(request, env);
      } else if (method === "GET" && path === "/api/admin/audit") {
        response = await handleAdminAuditList(request, env);
      } else if (method === "POST" && path === "/api/admin/mfa/enroll") {
        response = await handleMfaEnroll(request, env);
      } else if (method === "POST" && path === "/api/admin/mfa/verify") {
        response = await handleMfaVerify(request, env);
      } else if (method === "POST" && path === "/api/admin/mfa/disable") {
        response = await handleMfaDisable(request, env);

      // ── Public: licence ───────────────────────────────────────────────────
      } else if (method === "POST" && path === "/api/licence/validate") {
        const limit = await checkRateLimit(clientIp, path, env.LICENCE_KV);
        if (!limit.allowed) {
          response = json({
            error: "rate_limit_exceeded",
            message: "Too many licence validation requests. Please try again later.",
            resetAt: new Date(limit.resetAt).toISOString()
          }, 429);
        } else {
          response = await handleValidate(request, env);
        }
      } else if (method === "GET" && path === "/api/licence/heartbeat") {
        response = await handleHeartbeat(env);
      } else if (method === "POST" && path === "/api/licence/field-mappings/sync") {
        const limit = await checkRateLimit(clientIp, path, env.LICENCE_KV);
        if (!limit.allowed) {
          response = json({
            error: "rate_limit_exceeded",
            message: "Too many field-mapping sync requests. Please try again later.",
            resetAt: new Date(limit.resetAt).toISOString()
          }, 429);
        } else {
          response = await handleFieldMappingSync(request, env);
        }

      // ── Admin: analytics ──────────────────────────────────────────────────
      } else if (method === "GET" && path === "/api/admin/analytics") {
        response = await handleAdminAnalytics(request, env);

      // ── Admin: tenants ────────────────────────────────────────────────────
      } else if (method === "GET" && path === "/api/admin/tenants") {
        response = await handleListTenants(request, env);
      } else if (method === "POST" && path === "/api/admin/tenants") {
        response = await handleCreateTenant(request, env);
      } else {
        const tenantMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)(\/.*)?$/);
        const ruleMatch = path.match(/^\/api\/admin\/rules\/([^/]+)$/);
        if (tenantMatch) {
          const tenantId = tenantMatch[1];
          const sub = tenantMatch[2] || "";

          if (sub === "/regenerate-key" && method === "POST") response = await handleRegenerateKey(tenantId, request, env);
          else if (sub === "/offline-token" && method === "POST") response = await handleGenerateOfflineToken(tenantId, request, env);
          else if (sub === "/licence-key" && method === "GET") response = await handleGetLicenceKey(tenantId, request, env);
          else if (sub === "/licence-key" && method === "DELETE") response = await handleDeleteLicenceKey(tenantId, request, env);
          else if (sub === "/field-mappings" && method === "GET") response = await handleGetTenantFieldMappings(tenantId, request, env);
          else if (sub === "/field-mappings" && (method === "PUT" || method === "POST")) response = await handleUpsertTenantFieldMappings(tenantId, request, env);
          else if (sub === "" && method === "GET") response = await handleGetTenant(tenantId, request, env);
          else if (sub === "" && method === "PUT") response = await handleUpdateTenant(tenantId, request, env, false);
          else if (sub === "" && method === "PATCH") response = await handleUpdateTenant(tenantId, request, env, true);
          else if (sub === "" && method === "DELETE") response = await handleDeleteTenant(tenantId, request, env);
          else response = json({ error: "not_found" }, 404);
        } else if (path === "/api/admin/rules" && method === "GET") {
          response = await handleListRules(request, env);
        } else if (path === "/api/admin/rules" && method === "POST") {
          response = await handleCreateRule(request, env);
        } else if (path === "/api/admin/rules/import" && method === "POST") {
          response = await handleBulkImportRules(request, env);
        } else if (ruleMatch) {
          const ruleId = ruleMatch[1];
          if (method === "GET") response = await handleGetRule(ruleId, request, env);
          else if (method === "PUT") response = await handleUpdateRule(ruleId, request, env, false);
          else if (method === "PATCH") response = await handleUpdateRule(ruleId, request, env, true);
          else if (method === "DELETE") response = await handleDeleteRule(ruleId, request, env);
          else response = json({ error: "not_found" }, 404);

        // ── Admin: platform release ─────────────────────────────────────────
        } else if (path === "/api/admin/release" && method === "GET") {
          response = await handleGetRelease(request, env);
        } else if (path === "/api/admin/release" && method === "PUT") {
          response = await handleUpdateRelease(request, env);
        } else {
          response = json({ error: "not_found" }, 404);
        }
      }

      // Audit log (best-effort — never breaks the response)
      if (path.startsWith("/api/admin/")) {
        // Try to recover the auth payload so the audit row carries admin_id.
        try {
          const authHeader = request.headers.get("Authorization");
          if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.slice(7);
            authPayloadForAudit = await verifyJwt(token, env.JWT_SECRET, { db: env.DB });
          }
        } catch {
          authPayloadForAudit = null;
        }
        await writeAdminAudit(request, env, response, authPayloadForAudit);
      }
    } catch (err) {
      logJson("error", "unhandled_worker_error", { err: String(err), path });
      response = json({ error: "internal_error" }, 500);
    }

    return cors(response, request, env);
  },
};
