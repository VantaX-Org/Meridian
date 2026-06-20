var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// password-hash.ts
var ITERATIONS = 1e5;
var HASH_ALGORITHM = "SHA-256";
var SALT_BYTES = 32;
var KEY_LENGTH = 32;
function generateSalt() {
  const saltBuffer = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return bufferToHex(saltBuffer);
}
__name(generateSalt, "generateSalt");
async function hashPassword(password, salt) {
  const saltToUse = salt || generateSalt();
  const saltBuffer = hexToBuffer(saltToUse);
  const passwordBuffer = new TextEncoder().encode(password);
  const keyBuffer = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      hash: HASH_ALGORITHM,
      iterations: ITERATIONS
    },
    await crypto.subtle.importKey("raw", passwordBuffer, "PBKDF2", false, ["deriveKey"]),
    { name: "AES-GCM", length: KEY_LENGTH * 8 },
    true,
    ["encrypt"]
  );
  const exportedKey = await crypto.subtle.exportKey("raw", keyBuffer);
  const hashHex = bufferToHex(new Uint8Array(exportedKey));
  return { hash: hashHex, salt: saltToUse };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, hash, salt) {
  const { hash: computedHash } = await hashPassword(password, salt);
  return constantTimeCompare(computedHash, hash);
}
__name(verifyPassword, "verifyPassword");
function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
__name(constantTimeCompare, "constantTimeCompare");
function bufferToHex(buffer) {
  return Array.from(buffer).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bufferToHex, "bufferToHex");
function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
__name(hexToBuffer, "hexToBuffer");

// totp.ts
var TOTP_STEP_SECONDS = 30;
var TOTP_DIGITS = 6;
var TOTP_SECRET_BYTES = 20;
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[value << 5 - bits & 31];
  }
  return output;
}
__name(base32Encode, "base32Encode");
function base32Decode(str) {
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
__name(base32Decode, "base32Decode");
function bufferToHex2(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bufferToHex2, "bufferToHex");
function generateTotpSecret() {
  const buf = new Uint8Array(TOTP_SECRET_BYTES);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}
__name(generateTotpSecret, "generateTotpSecret");
function buildOtpauthUri(params) {
  const { secret, accountName, issuer } = params;
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
__name(buildOtpauthUri, "buildOtpauthUri");
async function hotp(secretBytes, counter) {
  const counterBuf = new Uint8Array(8);
  const view = new DataView(counterBuf.buffer);
  view.setUint32(4, counter & 4294967295, false);
  view.setUint32(0, Math.floor(counter / 4294967296), false);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[sig.length - 1] & 15;
  const binCode = (sig[offset] & 127) << 24 | (sig[offset + 1] & 255) << 16 | (sig[offset + 2] & 255) << 8 | sig[offset + 3] & 255;
  const mod = 10 ** TOTP_DIGITS;
  return (binCode % mod).toString().padStart(TOTP_DIGITS, "0");
}
__name(hotp, "hotp");
async function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(code.trim())) return false;
  const secretBytes = base32Decode(secret);
  const now = Math.floor(Date.now() / 1e3);
  const currentStep = Math.floor(now / TOTP_STEP_SECONDS);
  const candidates = [currentStep - 1, currentStep, currentStep + 1];
  const expected = await Promise.all(candidates.map((c) => hotp(secretBytes, c)));
  for (const e of expected) {
    let diff = e.length ^ code.length;
    for (let i = 0; i < e.length; i++) {
      diff |= e.charCodeAt(i) ^ code.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}
__name(verifyTotp, "verifyTotp");
async function generateRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let plaintext = "";
  for (let i = 0; i < buf.length; i++) {
    plaintext += alphabet[buf[i] % alphabet.length];
    if (i % 4 === 3 && i < buf.length - 1) plaintext += "-";
  }
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  const hash = bufferToHex2(new Uint8Array(hashBuf));
  return { plaintext, hash };
}
__name(generateRecoveryCode, "generateRecoveryCode");
async function hashRecoveryCode(code) {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return bufferToHex2(new Uint8Array(hashBuf));
}
__name(hashRecoveryCode, "hashRecoveryCode");

// src/index.ts
function generateId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateId, "generateId");
function generateLicenceKey() {
  const seg = /* @__PURE__ */ __name(() => {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }, "seg");
  return `MRDX-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}
__name(generateLicenceKey, "generateLicenceKey");
async function hashKey(key) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashKey, "hashKey");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
var RATE_LIMIT_CONFIG = {
  "/api/admin/login": { maxRequests: 5, windowSeconds: 5 * 60 },
  // 5 req/5min
  "/api/licence/validate": { maxRequests: 100, windowSeconds: 60 * 60 },
  // 100 req/1hr
  "/api/licence/field-mappings/sync": { maxRequests: 60, windowSeconds: 60 }
  // 60 req/min
};
async function checkRateLimit(ip, endpoint, kv) {
  const config = RATE_LIMIT_CONFIG[endpoint];
  if (!config) {
    return { allowed: true, remaining: -1, resetAt: 0 };
  }
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1e3;
  const kvKey = `ratelimit:${endpoint}:${ip}`;
  try {
    const stored = await kv.get(kvKey);
    let data = { count: 0, windowStart: now };
    if (stored) {
      data = JSON.parse(stored);
      if (data.windowStart < windowStart) {
        data = { count: 0, windowStart: now };
      }
    }
    const remaining = config.maxRequests - data.count;
    const allowed = data.count < config.maxRequests;
    data.count += 1;
    const expirationTtl = config.windowSeconds + 60;
    await kv.put(kvKey, JSON.stringify(data), {
      expirationTtl,
      metadata: { endpoint, ip, timestamp: now.toString() }
    });
    const resetAt = data.windowStart + config.windowSeconds * 1e3;
    return { allowed, remaining: Math.max(0, remaining), resetAt };
  } catch (err) {
    console.error(`Rate limit check failed for ${ip}:${endpoint}`, err);
    return { allowed: true, remaining: -1, resetAt: 0 };
  }
}
__name(checkRateLimit, "checkRateLimit");
function logJson(level, event, fields = {}) {
  const line = JSON.stringify({ ts: nowIso(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
__name(logJson, "logJson");
function escapeLike(s) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
__name(escapeLike, "escapeLike");
function parseAllowedOrigins(env) {
  const raw = (env.CORS_ALLOWED_ORIGINS || "").trim();
  if (raw === "ALLOW_ALL") return { allowAll: true, list: [] };
  if (!raw) return { allowAll: false, list: [] };
  return { allowAll: false, list: raw.split(",").map((s) => s.trim()).filter(Boolean) };
}
__name(parseAllowedOrigins, "parseAllowedOrigins");
function corsHeaders(request, env) {
  const { allowAll, list } = parseAllowedOrigins(env);
  const reqOrigin = request.headers.get("Origin") || "";
  const common = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
  if (allowAll) {
    return { ...common, "Access-Control-Allow-Origin": "*" };
  }
  if (reqOrigin && list.includes(reqOrigin)) {
    return {
      ...common,
      "Access-Control-Allow-Origin": reqOrigin,
      "Access-Control-Allow-Credentials": "true"
    };
  }
  return common;
}
__name(corsHeaders, "corsHeaders");
function cors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}
__name(cors, "cors");
function json(data, status = 200, request, env) {
  const body = new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
  if (request && env) return cors(body, request, env);
  return body;
}
__name(json, "json");
function b64url(data) {
  return btoa(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64url, "b64url");
function b64urlDecode(s) {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}
__name(b64urlDecode, "b64urlDecode");
async function signJwt(payload, secret) {
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
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}
__name(signJwt, "signJwt");
async function verifyJwt(token, secret, opts = {}) {
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
  let sigBytes;
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
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (typeof payload.iat === "number" && payload.iat > nowSec + 60) {
    return null;
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return null;
  }
  if (opts.db && typeof payload.jti === "string" && payload.jti) {
    try {
      const row = await opts.db.prepare(
        "SELECT revoked_at, expires_at FROM admin_sessions WHERE jti = ?"
      ).bind(payload.jti).first();
      if (row) {
        if (row.revoked_at) return null;
        if (new Date(row.expires_at).getTime() < Date.now()) return null;
      } else {
        return null;
      }
    } catch (err) {
      logJson("error", "jwt_revocation_check_failed", { err: String(err) });
      return null;
    }
  }
  return payload;
}
__name(verifyJwt, "verifyJwt");
async function requireAuth(request, env, allowedRoles = ["admin"]) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "unauthorized", message: "Missing or invalid Authorization header" }, 401) };
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET, { db: env.DB });
  if (!payload) {
    return { ok: false, response: json({ error: "unauthorized", message: "Invalid or expired token" }, 401) };
  }
  const role = String(payload.role ?? "");
  if (!allowedRoles.includes(role)) {
    return { ok: false, response: json({ error: "forbidden", message: "Insufficient role" }, 403) };
  }
  return { ok: true, payload };
}
__name(requireAuth, "requireAuth");
async function requireAdmin(request, env) {
  const r = await requireAuth(request, env, ["admin"]);
  return r.ok ? null : r.response;
}
__name(requireAdmin, "requireAdmin");
function parseTenant(row) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_email: row.contact_email,
    licence_key_masked: row.licence_key_suffix ? `MRDX-****-****-${row.licence_key_suffix}` : null,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    enabled_modules: JSON.parse(row.enabled_modules || "[]"),
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]"),
    features: JSON.parse(row.features || "{}"),
    llm_config: JSON.parse(row.llm_config || "{}"),
    machine_fingerprint: row.machine_fingerprint,
    last_ping: row.last_ping,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(parseTenant, "parseTenant");
function parseRule(row) {
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
    tags: JSON.parse(row.tags || "[]"),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(parseRule, "parseRule");
function parseFieldMapping(row) {
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
    updated_at: row.updated_at
  };
}
__name(parseFieldMapping, "parseFieldMapping");
function daysRemaining(expiryDate) {
  const diff = new Date(expiryDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1e3 * 60 * 60 * 24)));
}
__name(daysRemaining, "daysRemaining");
var DEFAULT_MENU_ITEMS = [
  "dashboard",
  "findings",
  "versions",
  "analytics",
  "import",
  "sync",
  "reports",
  "stewardship",
  "contracts",
  "ask_meridian",
  "export",
  "user_management",
  "settings",
  "licence"
];
var DEFAULT_FEATURES = {
  ask_meridian: true,
  export_reports: true,
  run_sync: true,
  field_mapping_self_service: false,
  max_users: 20
};
var TIER_MODULES = {
  starter: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders"
  ],
  professional: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders",
    "employee_central",
    "compensation",
    "benefits",
    "payroll_integration",
    "performance_goals",
    "succession_planning",
    "recruiting_onboarding",
    "learning_management",
    "time_attendance"
  ],
  enterprise: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders",
    "employee_central",
    "compensation",
    "benefits",
    "payroll_integration",
    "performance_goals",
    "succession_planning",
    "recruiting_onboarding",
    "learning_management",
    "time_attendance",
    "ewms_stock",
    "ewms_transfer_orders",
    "batch_management",
    "mdg_master_data",
    "grc_compliance",
    "fleet_management",
    "transport_management",
    "wm_interface",
    "cross_system_integration"
  ]
};
var LOCKOUT_THRESHOLD = 5;
var LOCKOUT_DURATION_MS = 15 * 60 * 1e3;
async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }
  try {
    const admin = await env.DB.prepare(
      "SELECT id, email, password_hash, password_salt, role, is_active, failed_attempts, locked_until, mfa_secret, mfa_enabled, mfa_recovery_hash FROM admins WHERE email = ? LIMIT 1"
    ).bind(body.email).first();
    const genericReject = /* @__PURE__ */ __name(() => json({ error: "unauthorized", message: "Invalid credentials" }, 401), "genericReject");
    if (!admin || !admin.is_active) {
      await verifyPassword(
        body.password,
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0000000000000000000000000000000000000000000000000000000000000000"
      ).catch(() => false);
      return genericReject();
    }
    if (admin.locked_until) {
      const until = new Date(admin.locked_until).getTime();
      if (until > Date.now()) {
        return json({
          error: "locked",
          message: "Account temporarily locked due to repeated failed logins. Try again later.",
          retry_after_seconds: Math.ceil((until - Date.now()) / 1e3)
        }, 423);
      }
    }
    const passwordValid = await verifyPassword(body.password, admin.password_hash, admin.password_salt);
    if (!passwordValid) {
      const attempts = (admin.failed_attempts ?? 0) + 1;
      const lockUntil = attempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString() : null;
      try {
        await env.DB.prepare(
          "UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?"
        ).bind(attempts, lockUntil, admin.id).run();
      } catch (err) {
        logJson("warn", "admin_login_fail_counter_update_error", { err: String(err) });
      }
      if (lockUntil) {
        logJson("warn", "admin_account_locked", { admin_id: admin.id, email: admin.email, attempts });
      }
      return genericReject();
    }
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
          return json({ error: "mfa_required", mfa_required: true }, 401);
        }
        const attempts = (admin.failed_attempts ?? 0) + 1;
        const lockUntil = attempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString() : null;
        try {
          await env.DB.prepare(
            "UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?"
          ).bind(attempts, lockUntil, admin.id).run();
        } catch (err) {
          logJson("warn", "admin_mfa_fail_counter_update_error", { err: String(err) });
        }
        if (lockUntil) {
          logJson("warn", "admin_account_locked_mfa", { admin_id: admin.id, attempts });
        }
        return json({ error: "mfa_invalid", message: "Invalid MFA code" }, 401);
      }
      if (usedRecovery) {
        try {
          await env.DB.prepare(
            "UPDATE admins SET mfa_recovery_hash = NULL, mfa_enabled = 0, mfa_secret = NULL WHERE id = ?"
          ).bind(admin.id).run();
        } catch (err) {
          logJson("warn", "admin_mfa_recovery_cleanup_error", { err: String(err) });
        }
        logJson("warn", "admin_mfa_recovery_used", { admin_id: admin.id, email: admin.email });
      }
    }
    try {
      await env.DB.prepare(
        "UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(admin.id).run();
    } catch {
    }
    const nowSec = Math.floor(Date.now() / 1e3);
    const jti = generateId();
    const expSec = nowSec + 8 * 60 * 60;
    const token = await signJwt(
      {
        sub: admin.email,
        role: admin.role,
        jti,
        iat: nowSec,
        exp: expSec
      },
      env.JWT_SECRET
    );
    try {
      await env.DB.prepare(
        "INSERT INTO admin_sessions (jti, admin_id, issued_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        jti,
        admin.id,
        nowIso(),
        new Date(expSec * 1e3).toISOString(),
        nowIso(),
        request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || null,
        request.headers.get("user-agent") || null
      ).run();
    } catch (err) {
      logJson("warn", "admin_session_insert_error", { err: String(err) });
      return json({ error: "service_unavailable", message: "Authentication temporarily unavailable" }, 503);
    }
    logJson("info", "admin_login_success", { admin_id: admin.id, email: admin.email, jti });
    return json({ token, expiresIn: 8 * 60 * 60 });
  } catch (err) {
    logJson("error", "admin_login_db_error", { err: String(err) });
    return json({ error: "service_unavailable", message: "Authentication temporarily unavailable" }, 503);
  }
}
__name(handleLogin, "handleLogin");
async function handleGenerateOfflineToken(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  if (!env.OFFLINE_JWT_PRIVATE_KEY) {
    return json(
      { error: "not_configured", message: "OFFLINE_JWT_PRIVATE_KEY secret is not set" },
      503
    );
  }
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const body = await request.json().catch(() => ({}));
  const expiryDays = Math.min(Math.max(Number(body.expiryDays) || 365, 1), 1095);
  const nowSec = Math.floor(Date.now() / 1e3);
  const exp = nowSec + expiryDays * 86400;
  const expiresAt = new Date(exp * 1e3).toISOString();
  const rulesResult = await env.DB.prepare(
    "SELECT * FROM rules WHERE enabled = 1 ORDER BY module, category"
  ).all();
  const rules = (rulesResult.results || []).map(parseRule);
  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ?"
  ).bind(tenantId).all();
  const fieldMappings = (mappingsResult.results || []).map(parseFieldMapping);
  const payload = {
    iss: "meridian-hq",
    sub: tenantId,
    iat: nowSec,
    exp,
    tenant_id: tenantId,
    enabled_modules: JSON.parse(row.enabled_modules || "[]"),
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]"),
    features: JSON.parse(row.features || "{}"),
    llm_config: JSON.parse(row.llm_config || "{}"),
    rules,
    field_mappings: fieldMappings
  };
  const keyPem = env.OFFLINE_JWT_PRIVATE_KEY.trim();
  const pemBody = keyPem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encode = /* @__PURE__ */ __name((obj) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "encode");
  const headerB64 = encode({ alg: "RS256", typ: "JWT" });
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return json({ token: `${signingInput}.${sig}`, expiresAt, expiryDays });
}
__name(handleGenerateOfflineToken, "handleGenerateOfflineToken");
function entitlementCanonical(f) {
  const featKeys = Object.keys(f.features).filter((k) => !!f.features[k]).sort();
  return [
    "meridian-licence-v1",
    "1",
    // valid
    f.tenant_id,
    f.expiry_date,
    [...f.enabled_modules].sort().join(","),
    [...f.enabled_menu_items].sort().join(","),
    featKeys.join(","),
    f.machine_fingerprint || "",
    String(f.signed_at)
  ].join("\n");
}
__name(entitlementCanonical, "entitlementCanonical");
async function signEntitlement(env, canonical) {
  if (!env.OFFLINE_JWT_PRIVATE_KEY) return null;
  const pemBody = env.OFFLINE_JWT_PRIVATE_KEY.trim().replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
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
__name(signEntitlement, "signEntitlement");
async function trackNode(env, tenantId, fingerprint) {
  await env.DB.prepare(
    `INSERT INTO licence_nodes (tenant_id, fingerprint, first_seen, last_seen, ping_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(tenant_id, fingerprint)
     DO UPDATE SET last_seen = excluded.last_seen, ping_count = ping_count + 1`
  ).bind(tenantId, fingerprint, nowIso(), nowIso()).run();
}
__name(trackNode, "trackNode");
async function handleValidate(request, env) {
  const body = await request.json();
  const licenceKey = body.licenceKey || body.licence_key;
  const machineFingerprint = body.machineFingerprint || body.machine_fingerprint;
  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }
  const keyHash = await hashKey(licenceKey);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?").bind(keyHash).first();
  if (!row) {
    return json({ valid: false, reason: "invalid_key" }, 403);
  }
  if (row.status === "suspended") {
    return json({ valid: false, reason: "suspended" }, 403);
  }
  const expiry = new Date(row.expiry_date);
  const expired = expiry < /* @__PURE__ */ new Date();
  const gracePeriodEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1e3);
  const inGrace = expired && /* @__PURE__ */ new Date() < gracePeriodEnd;
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
  ).bind(nowIso(), machineFingerprint || null, nowIso(), row.id).run();
  if (machineFingerprint) {
    try {
      await trackNode(env, row.id, machineFingerprint);
    } catch (e) {
      console.warn("node tracking failed (non-fatal):", e);
    }
  }
  const enabledModules = JSON.parse(row.enabled_modules || "[]");
  let rules = [];
  if (enabledModules.length > 0) {
    const placeholders = enabledModules.map(() => "?").join(",");
    const rulesResult = await env.DB.prepare(
      `SELECT * FROM rules WHERE enabled = 1 AND module IN (${placeholders}) ORDER BY module, id`
    ).bind(...enabledModules).all();
    rules = (rulesResult.results || []).map(parseRule);
  }
  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field"
  ).bind(row.id).all();
  const enabledMenuItems = JSON.parse(row.enabled_menu_items || "[]");
  const features = JSON.parse(row.features || "{}");
  const signedAt = Math.floor(Date.now() / 1e3);
  const fingerprint = machineFingerprint || "";
  const signature = await signEntitlement(
    env,
    entitlementCanonical({
      tenant_id: row.id,
      expiry_date: row.expiry_date,
      enabled_modules: enabledModules,
      enabled_menu_items: enabledMenuItems,
      features,
      machine_fingerprint: fingerprint,
      signed_at: signedAt
    })
  );
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
    llm_config: JSON.parse(row.llm_config || "{}"),
    // Anti-self-grant signature (verified by clients that set LICENCE_SERVER_PUBLIC_KEY).
    signature,
    signed_at: signedAt,
    machine_fingerprint: fingerprint,
    signature_alg: "RS256-canonical-v1"
  });
}
__name(handleValidate, "handleValidate");
async function handleHeartbeat(env) {
  let dbOk = true;
  let dbError;
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message : "unknown";
  }
  return json(
    { status: dbOk ? "ok" : "degraded", ts: nowIso(), db: dbOk ? "ok" : "error", ...dbError ? { db_error: dbError } : {} },
    dbOk ? 200 : 503
  );
}
__name(handleHeartbeat, "handleHeartbeat");
async function handleFieldMappingSync(request, env) {
  const body = await request.json();
  const licenceKey = body.licenceKey || body.licence_key;
  const { mappings } = body;
  if (!licenceKey || !Array.isArray(mappings)) {
    return json({ error: "bad_request", message: "licenceKey and mappings are required" }, 400);
  }
  const keyHash = await hashKey(licenceKey);
  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE licence_key_hash = ?").bind(keyHash).first();
  if (!tenant) return json({ error: "unauthorized", message: "Invalid licence key" }, 401);
  const features = await env.DB.prepare("SELECT features FROM tenants WHERE id = ?").bind(tenant.id).first();
  const featureObj = JSON.parse(features?.features || "{}");
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
    `).bind(
      generateId(),
      tenant.id,
      m.module,
      m.standard_field,
      m.customer_field,
      m.customer_label || null,
      m.is_mapped ? 1 : 0,
      m.notes || null,
      ts
    ).run();
    upserted++;
  }
  return json({ synced: upserted, tenant_id: tenant.id });
}
__name(handleFieldMappingSync, "handleFieldMappingSync");
async function handleAdminAnalytics(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const allTenantsResult = await env.DB.prepare(
    "SELECT status, tier, expiry_date FROM tenants"
  ).all();
  const rows = allTenantsResult.results || [];
  const total = rows.length;
  const byStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const byTier = rows.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {});
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
  const expiringResult = await env.DB.prepare(
    "SELECT id, company_name, expiry_date, tier, status FROM tenants WHERE status = 'active' AND expiry_date <= ? ORDER BY expiry_date ASC LIMIT 10"
  ).bind(thirtyDaysLater).all();
  const recentPingsResult = await env.DB.prepare(
    "SELECT id, company_name, last_ping, status FROM tenants WHERE last_ping IS NOT NULL ORDER BY last_ping DESC LIMIT 10"
  ).all();
  let concurrentNodes = [];
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
    const sharingResult = await env.DB.prepare(
      `SELECT n.tenant_id AS id, t.company_name AS company_name, COUNT(*) AS node_count
       FROM licence_nodes n JOIN tenants t ON t.id = n.tenant_id
       WHERE n.last_seen >= ?
       GROUP BY n.tenant_id HAVING COUNT(*) > 1
       ORDER BY node_count DESC LIMIT 10`
    ).bind(since).all();
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
    concurrent_nodes: concurrentNodes
  });
}
__name(handleAdminAnalytics, "handleAdminAnalytics");
async function handleListTenants(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const search = url.searchParams.get("q");
  let query = "SELECT * FROM tenants";
  const params = [];
  const conditions = [];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (tier) {
    conditions.push("tier = ?");
    params.push(tier);
  }
  if (search) {
    const pattern = `%${escapeLike(search.toLowerCase())}%`;
    conditions.push("(LOWER(company_name) LIKE ? ESCAPE '\\' OR LOWER(contact_email) LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC";
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ tenants: (result.results || []).map(parseTenant) });
}
__name(handleListTenants, "handleListTenants");
async function handleCreateTenant(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
  const features = { ...DEFAULT_FEATURES, ...body.features || {} };
  const llmConfig = { tier: 1, model: "", notes: "", ...body.llm_config || {} };
  await env.DB.prepare(`
    INSERT INTO tenants (id, company_name, contact_email, licence_key_hash, licence_key_suffix, tier, status, expiry_date, enabled_modules, enabled_menu_items, features, llm_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.company_name,
    body.contact_email,
    keyHash,
    keySuffix,
    tier,
    body.status || "trial",
    body.expiry_date,
    JSON.stringify(enabledModules),
    JSON.stringify(enabledMenuItems),
    JSON.stringify(features),
    JSON.stringify(llmConfig),
    ts,
    ts
  ).run();
  if (body.admin_user?.email && body.admin_user?.password) {
    const userId = generateId();
    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(body.admin_user.password);
    await env.DB.prepare(`
      INSERT INTO tenant_users
        (id, tenant_id, email, password_hash, password_salt, password_scheme,
         role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pbkdf2', ?, ?, ?)
    `).bind(
      userId,
      id,
      body.admin_user.email,
      passwordHash,
      passwordSalt,
      body.admin_user.role || "admin",
      ts,
      ts
    ).run();
  }
  return json({ id, licence_key: licenceKey, company_name: body.company_name, tier, status: body.status || "trial" }, 201);
}
__name(handleCreateTenant, "handleCreateTenant");
async function handleGetTenant(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseTenant(row));
}
__name(handleGetTenant, "handleGetTenant");
async function handleUpdateTenant(tenantId, request, env, partial = false) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!existing) return json({ error: "not_found" }, 404);
  const fields = [];
  const values = [];
  if (body.company_name !== void 0) {
    fields.push("company_name = ?");
    values.push(body.company_name);
  }
  if (body.contact_email !== void 0) {
    fields.push("contact_email = ?");
    values.push(body.contact_email);
  }
  if (body.tier !== void 0) {
    fields.push("tier = ?");
    values.push(body.tier);
  }
  if (body.status !== void 0) {
    fields.push("status = ?");
    values.push(body.status);
  }
  if (body.expiry_date !== void 0) {
    fields.push("expiry_date = ?");
    values.push(body.expiry_date);
  }
  if (body.enabled_modules !== void 0) {
    fields.push("enabled_modules = ?");
    values.push(JSON.stringify(body.enabled_modules));
  }
  if (body.enabled_menu_items !== void 0) {
    fields.push("enabled_menu_items = ?");
    values.push(JSON.stringify(body.enabled_menu_items));
  }
  if (body.features !== void 0) {
    const merged = partial ? { ...JSON.parse(existing.features || "{}"), ...body.features } : body.features;
    fields.push("features = ?");
    values.push(JSON.stringify(merged));
  }
  if (body.llm_config !== void 0) {
    const merged = partial ? { ...JSON.parse(existing.llm_config || "{}"), ...body.llm_config } : body.llm_config;
    fields.push("llm_config = ?");
    values.push(JSON.stringify(merged));
  }
  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(tenantId);
  await env.DB.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  return json(parseTenant(updated));
}
__name(handleUpdateTenant, "handleUpdateTenant");
async function handleDeleteTenant(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM tenant_users WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM field_mappings WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
  logJson("info", "tenant_deleted", { tenant_id: tenantId });
  return json({ deleted: true, id: tenantId });
}
__name(handleDeleteTenant, "handleDeleteTenant");
async function handleRegenerateKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const newKey = generateLicenceKey();
  const newHash = await hashKey(newKey);
  const newSuffix = newKey.slice(-4);
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = ?, licence_key_suffix = ?, updated_at = ? WHERE id = ?"
  ).bind(newHash, newSuffix, nowIso(), tenantId).run();
  return json({ licence_key: newKey, tenant_id: tenantId });
}
__name(handleRegenerateKey, "handleRegenerateKey");
async function handleGetTenantFieldMappings(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const module = url.searchParams.get("module");
  const query = module ? "SELECT * FROM field_mappings WHERE tenant_id = ? AND module = ? ORDER BY standard_field" : "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field";
  const params = module ? [tenantId, module] : [tenantId];
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ field_mappings: (result.results || []).map(parseFieldMapping) });
}
__name(handleGetTenantFieldMappings, "handleGetTenantFieldMappings");
async function handleUpsertTenantFieldMappings(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
    `).bind(
      generateId(),
      tenantId,
      m.module,
      m.standard_field,
      m.standard_label || null,
      m.customer_field || null,
      m.customer_label || null,
      m.data_type || "string",
      m.is_mapped ? 1 : 0,
      m.notes || null,
      ts
    ).run();
    upserted++;
  }
  return json({ upserted });
}
__name(handleUpsertTenantFieldMappings, "handleUpsertTenantFieldMappings");
async function handleListRules(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const module = url.searchParams.get("module");
  const severity = url.searchParams.get("severity");
  const enabled = url.searchParams.get("enabled");
  const search = url.searchParams.get("q");
  let query = "SELECT * FROM rules";
  const params = [];
  const conditions = [];
  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (module) {
    conditions.push("module = ?");
    params.push(module);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }
  if (enabled !== null && enabled !== "") {
    conditions.push("enabled = ?");
    params.push(enabled === "true" ? 1 : 0);
  }
  if (search) {
    conditions.push("LOWER(name) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(search.toLowerCase())}%`);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY category, module, id";
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ rules: (result.results || []).map(parseRule), total: result.results?.length || 0 });
}
__name(handleListRules, "handleListRules");
async function handleCreateRule(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  if (!body.name || !body.module || !body.category) {
    return json({ error: "bad_request", message: "name, module, and category are required" }, 400);
  }
  const id = generateId();
  const ts = nowIso();
  await env.DB.prepare(`
    INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name,
    body.description || null,
    body.module,
    body.category,
    body.severity || "medium",
    body.enabled !== false ? 1 : 0,
    JSON.stringify(body.conditions || []),
    JSON.stringify(body.thresholds || {}),
    JSON.stringify(body.tags || []),
    ts,
    ts
  ).run();
  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
  return json(parseRule(row), 201);
}
__name(handleCreateRule, "handleCreateRule");
async function handleGetRule(ruleId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseRule(row));
}
__name(handleGetRule, "handleGetRule");
async function handleUpdateRule(ruleId, request, env, partial = false) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  if (!existing) return json({ error: "not_found" }, 404);
  const fields = [];
  const values = [];
  if (body.name !== void 0) {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (body.description !== void 0) {
    fields.push("description = ?");
    values.push(body.description);
  }
  if (body.module !== void 0) {
    fields.push("module = ?");
    values.push(body.module);
  }
  if (body.category !== void 0) {
    fields.push("category = ?");
    values.push(body.category);
  }
  if (body.severity !== void 0) {
    fields.push("severity = ?");
    values.push(body.severity);
  }
  if (body.enabled !== void 0) {
    fields.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (body.conditions !== void 0) {
    fields.push("conditions = ?");
    values.push(JSON.stringify(body.conditions));
  }
  if (body.thresholds !== void 0) {
    fields.push("thresholds = ?");
    values.push(JSON.stringify(body.thresholds));
  }
  if (body.tags !== void 0) {
    fields.push("tags = ?");
    values.push(JSON.stringify(body.tags));
  }
  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(ruleId);
  await env.DB.prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  return json(parseRule(updated));
}
__name(handleUpdateRule, "handleUpdateRule");
async function handleDeleteRule(ruleId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM rules WHERE id = ?").bind(ruleId).first();
  if (!row) return json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
  return json({ deleted: true, id: ruleId });
}
__name(handleDeleteRule, "handleDeleteRule");
async function handleBulkImportRules(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
    `).bind(
      id,
      r.name,
      r.description || null,
      r.module,
      r.category,
      r.severity || "medium",
      r.enabled !== false ? 1 : 0,
      JSON.stringify(r.conditions || []),
      JSON.stringify(r.thresholds || {}),
      JSON.stringify(r.tags || []),
      ts,
      ts
    ).run();
    imported++;
  }
  return json({ imported });
}
__name(handleBulkImportRules, "handleBulkImportRules");
async function handleTenantUserLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }
  const user = await env.DB.prepare(
    "SELECT id, tenant_id, email, role, password_hash, password_salt, password_scheme, is_active FROM tenant_users WHERE email = ? LIMIT 1"
  ).bind(body.email).first();
  if (!user || user.is_active !== null && user.is_active === 0) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }
  let passwordValid = false;
  const scheme = user.password_scheme || "sha256";
  if (scheme === "pbkdf2") {
    if (!user.password_salt) {
      return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
    }
    passwordValid = await verifyPassword(body.password, user.password_hash, user.password_salt);
  } else if (scheme === "sha256") {
    const computed = await hashKey(body.password);
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
  if (scheme === "sha256") {
    try {
      const { hash: newHash, salt: newSalt } = await hashPassword(body.password);
      await env.DB.prepare(
        "UPDATE tenant_users SET password_hash = ?, password_salt = ?, password_scheme = 'pbkdf2', updated_at = ? WHERE id = ?"
      ).bind(newHash, newSalt, nowIso(), user.id).run();
    } catch (err) {
      console.warn("tenant_users PBKDF2 upgrade failed for", user.id, err);
    }
  }
  try {
    await env.DB.prepare("UPDATE tenant_users SET last_login_at = ? WHERE id = ?").bind(nowIso(), user.id).run();
  } catch {
  }
  const tenant = await env.DB.prepare("SELECT company_name, status FROM tenants WHERE id = ?").bind(user.tenant_id).first();
  if (!tenant) {
    return json({ error: "unauthorized", message: "Tenant not found" }, 401);
  }
  if (tenant.status === "suspended") {
    return json({ error: "forbidden", message: "Tenant account is suspended" }, 403);
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  const token = await signJwt(
    {
      sub: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60
      // 8 hours
    },
    env.JWT_SECRET
  );
  return json({
    token,
    expiresIn: 8 * 60 * 60,
    tenant_id: user.tenant_id,
    company_name: tenant.company_name
  });
}
__name(handleTenantUserLogin, "handleTenantUserLogin");
async function handleGetLicenceKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT licence_key_hash FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!row.licence_key_hash) {
    return json({ error: "no_key", message: "This tenant has no active licence key" }, 404);
  }
  return json({
    message: "Licence key exists but cannot be retrieved (hashed)",
    has_key: true,
    tenant_id: tenantId
  });
}
__name(handleGetLicenceKey, "handleGetLicenceKey");
async function handleDeleteLicenceKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = NULL, licence_key_suffix = NULL, updated_at = ? WHERE id = ?"
  ).bind(ts, tenantId).run();
  return json({ deleted: true, tenant_id: tenantId });
}
__name(handleDeleteLicenceKey, "handleDeleteLicenceKey");
var _AUDIT_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function deriveEntityAndAction(method, path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "admin") {
    return { entity_type: null, entity_id: null, action: method.toLowerCase() };
  }
  const entity_type = parts[2] ?? null;
  const entity_id = parts.length >= 4 ? parts[3] ?? null : null;
  let action;
  if (method === "DELETE") action = "delete";
  else if (method === "POST" && parts.length >= 5) action = parts[4];
  else action = method.toLowerCase();
  return { entity_type, entity_id, action };
}
__name(deriveEntityAndAction, "deriveEntityAndAction");
async function writeAdminAudit(request, env, response, payload) {
  if (!_AUDIT_METHODS.has(request.method)) return;
  if (response.status >= 400) return;
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/")) return;
  if (path === "/api/admin/login" || path === "/api/admin/logout") return;
  const { entity_type, entity_id, action } = deriveEntityAndAction(request.method, path);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || null;
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit (id, admin_id, admin_email, action, entity_type, entity_id, method, path, status_code, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      generateId(),
      payload?.admin_id || null,
      payload?.sub || null,
      action,
      entity_type,
      entity_id,
      request.method,
      path,
      response.status,
      ip,
      request.headers.get("user-agent") || null,
      nowIso()
    ).run();
  } catch (err) {
    logJson("warn", "admin_audit_write_failed", { err: String(err), path });
  }
}
__name(writeAdminAudit, "writeAdminAudit");
async function handleAdminMe(request, env) {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const adminEmail = String(auth.payload.sub ?? "");
  const row = await env.DB.prepare(
    "SELECT id, email, role, is_active, last_login_at FROM admins WHERE email = ? LIMIT 1"
  ).bind(adminEmail).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({
    id: row.id,
    email: row.email,
    role: row.role,
    is_active: row.is_active === 1,
    last_login_at: row.last_login_at,
    session_jti: auth.payload.jti ?? null
  });
}
__name(handleAdminMe, "handleAdminMe");
async function handleAdminLogout(request, env) {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const jti = auth.payload.jti;
  if (typeof jti === "string" && jti) {
    try {
      await env.DB.prepare(
        "UPDATE admin_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL"
      ).bind(nowIso(), jti).run();
      logJson("info", "admin_logout", { email: auth.payload.sub, jti });
    } catch (err) {
      logJson("warn", "admin_logout_db_error", { err: String(err) });
    }
  }
  return json({ ok: true });
}
__name(handleAdminLogout, "handleAdminLogout");
async function handleMfaEnroll(request, env) {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const email = String(auth.payload.sub ?? "");
  const secret = generateTotpSecret();
  try {
    await env.DB.prepare(
      "UPDATE admins SET mfa_secret = ?, mfa_enabled = 0 WHERE email = ?"
    ).bind(secret, email).run();
  } catch (err) {
    logJson("error", "mfa_enroll_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  const otpauthUri = buildOtpauthUri({
    secret,
    accountName: email,
    issuer: "Meridian HQ"
  });
  return json({
    otpauth_uri: otpauthUri,
    secret
    // so admins who can't scan can type it in manually
  });
}
__name(handleMfaEnroll, "handleMfaEnroll");
async function handleMfaVerify(request, env) {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const email = String(auth.payload.sub ?? "");
  const body = await request.json().catch(() => ({}));
  if (!body.code) {
    return json({ error: "bad_request", message: "code is required" }, 400);
  }
  const admin = await env.DB.prepare(
    "SELECT id, mfa_secret FROM admins WHERE email = ?"
  ).bind(email).first();
  if (!admin || !admin.mfa_secret) {
    return json({ error: "not_enrolled", message: "Call /api/admin/mfa/enroll first" }, 400);
  }
  const ok = await verifyTotp(admin.mfa_secret, body.code);
  if (!ok) return json({ error: "mfa_invalid", message: "Invalid code" }, 401);
  const { plaintext: recovery, hash } = await generateRecoveryCode();
  try {
    await env.DB.prepare(
      "UPDATE admins SET mfa_enabled = 1, mfa_enrolled_at = ?, mfa_recovery_hash = ? WHERE id = ?"
    ).bind(nowIso(), hash, admin.id).run();
  } catch (err) {
    logJson("error", "mfa_verify_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  logJson("info", "mfa_enrolled", { admin_id: admin.id, email });
  return json({ enabled: true, recovery_code: recovery });
}
__name(handleMfaVerify, "handleMfaVerify");
async function handleMfaDisable(request, env) {
  const auth = await requireAuth(request, env, ["admin"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const targetEmail = body.email || String(auth.payload.sub ?? "");
  try {
    const result = await env.DB.prepare(
      "UPDATE admins SET mfa_enabled = 0, mfa_secret = NULL, mfa_recovery_hash = NULL, mfa_enrolled_at = NULL WHERE email = ?"
    ).bind(targetEmail).run();
    logJson("warn", "mfa_disabled", {
      actor: auth.payload.sub,
      target_email: targetEmail,
      changes: result.meta?.changes ?? 0
    });
  } catch (err) {
    logJson("error", "mfa_disable_write_error", { err: String(err) });
    return json({ error: "service_unavailable" }, 503);
  }
  return json({ disabled: true, email: targetEmail });
}
__name(handleMfaDisable, "handleMfaDisable");
async function handleAdminAuditList(request, env) {
  const auth = await requireAuth(request, env, ["admin", "readonly"]);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const entityType = url.searchParams.get("entity_type");
  const entityId = url.searchParams.get("entity_id");
  const conds = [];
  const params = [];
  if (entityType) {
    conds.push("entity_type = ?");
    params.push(entityType);
  }
  if (entityId) {
    conds.push("entity_id = ?");
    params.push(entityId);
  }
  const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
  const result = await env.DB.prepare(
    `SELECT id, admin_id, admin_email, action, entity_type, entity_id, method, path, status_code, ip, created_at FROM admin_audit${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();
  return json({ entries: result.results || [], limit, offset });
}
__name(handleAdminAuditList, "handleAdminAuditList");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), request, env);
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    let response;
    let authPayloadForAudit = null;
    try {
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
      } else if (method === "GET" && path === "/api/admin/analytics") {
        response = await handleAdminAnalytics(request, env);
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
        } else {
          response = json({ error: "not_found" }, 404);
        }
      }
      if (path.startsWith("/api/admin/")) {
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
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
